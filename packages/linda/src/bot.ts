// ============================================================================
// Linda — Bot
// One Agent per chatId. Role-aware: client (WhatsApp) vs admin (Telegram).
//
// Runtime-controlled flow:
//   1. Pre-call: runtime calls PSF get_current_step BEFORE the LLM
//   2. Guardrails: check for stuck/timeout before LLM runs (strict for client, relaxed for admin)
//   3. Inject: PSF state + guardrail hints injected into user message
//   4. Post-process: fallback intent detection, guardrail post-check
//   5. Logging: structured JSON with replySource, effectiveOutcome, redacted PII
// ============================================================================

import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { ConversationGuardrails, getGuardrailConfigForRole, guardrailHint, type TurnSignals } from "./guardrails.js";
import { detectIntentFromText } from "./intents.js";
import { type ReplySource, TurnLogger } from "./logger.js";
import { getSystemPrompt } from "./prompts/index.js";
import type { PsfClient } from "./psf.js";
import { getToolsForRole, type PsfToolsContext } from "./tools.js";
import type { AgentRole, BridgeRegistry, LindaChannel, TurnResponse, TurnStep } from "./types.js";
import type { ValidationRejectReason } from "./validation.js";

export interface LindaBotConfig {
	psf: PsfClient;
	model?: string;
	provider?: string;
	getApiKey: (provider: string) => Promise<string | undefined>;
	bridge?: BridgeRegistry;
}

export interface IncomingMessage {
	messageId: string;
	chatId: string;
	userId: string;
	text: string;
	channel: LindaChannel;
	/** Agent role — determines prompt, tools, guardrails, and access scope */
	role: AgentRole;
	sendText: (text: string, suggestions?: string[]) => Promise<void>;
	sendTyping: () => Promise<void>;
}

// ============================================================================
// Per-chat state
// ============================================================================

interface ChatState {
	agent: Agent;
	busy: Promise<void>;
	role: AgentRole;
	guardrails: ConversationGuardrails;
	/** Mutable ref to current step — updated by runtime before each turn */
	currentStep: TurnStep | undefined;
	currentMessage: { messageId: string; userText: string } | undefined;
}

export class LindaBot {
	private readonly chats = new Map<string, ChatState>();
	private readonly config: LindaBotConfig;

	constructor(config: LindaBotConfig) {
		this.config = config;
	}

	// --------------------------------------------------------------------------
	// Handle incoming message
	// --------------------------------------------------------------------------

	async handleMessage(msg: IncomingMessage): Promise<void> {
		const state = this.getOrCreateChat(msg);

		// Wait for previous message in this chat to finish, then process
		state.busy = state.busy.then(() => this.process(msg, state));
		await state.busy;
	}

	// --------------------------------------------------------------------------
	// Process one message with the chat's Agent
	// --------------------------------------------------------------------------

	private async process(msg: IncomingMessage, state: ChatState): Promise<void> {
		await msg.sendTyping().catch(() => {});

		const log = new TurnLogger(msg);
		let replySource: ReplySource = "none";

		// ---- Step 1: Runtime pre-calls PSF ----
		let psfState: TurnResponse;
		try {
			psfState = await this.config.psf.getTurn({
				userId: msg.userId,
				channel: msg.channel,
			});
			log.setPsfState(psfState);
		} catch (err) {
			log.setPsfError(err);
			log.flush();
			await msg.sendText("Извини, у меня проблема с подключением. Попробуй ещё раз через минуту.");
			return;
		}

		// Update mutable step ref for tool context
		state.currentStep = psfState.status === "active" ? psfState.step : undefined;
		state.currentMessage = { messageId: msg.messageId, userText: msg.text };

		// ---- Step 2: Guardrails pre-check ----
		const chatKey = `${msg.channel}:${msg.chatId}`;
		const currentStepId = psfState.status === "active" ? psfState.step.id : undefined;
		const preCheck = state.guardrails.checkBeforeTurn(chatKey, currentStepId);
		log.setGuardrailAction(preCheck);

		// ---- Step 3: Build context-enriched prompt for LLM ----
		const contextBlock = buildPsfContext(psfState, state.role);
		const hint = guardrailHint(preCheck) ?? "";
		const enrichedPrompt = `[MESSAGE_ID: ${msg.messageId}]\n${contextBlock}${hint}\n\nUser: ${msg.text}`;

		// ---- Step 4: Run LLM with event tracking ----
		let reply = "";
		let lastSuggestions: string[] = [];
		let submitDataCalled = false;
		let lastPsfTurn: TurnResponse | undefined;
		let turnNewValidFields: string[] = [];
		let turnHadValidationRejects = false;

		const unsub = state.agent.subscribe(async (event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				reply += event.assistantMessageEvent.delta;
			} else if (event.type === "tool_execution_start") {
				if (event.toolName === "submit_data") {
					submitDataCalled = true;
					log.setSubmitCalled(event.args as Record<string, unknown>);
				}
			} else if (event.type === "tool_execution_end") {
				const turnResult = (event.result as any)?.details?.turn as TurnResponse | undefined;
				lastPsfTurn = turnResult;
				if (turnResult) {
					log.setPsfResult(turnResult);
					state.currentStep = turnResult.status === "active" ? turnResult.step : undefined;
				}

				const validation = (event.result as any)?.details?.validation;
				if (validation) {
					const acceptedKeys = Object.keys(validation.cleaned ?? {});
					const rejectedEntries = (validation.rejected ?? []) as Array<{
						field: string;
						reason: ValidationRejectReason;
					}>;

					log.setValidation(
						acceptedKeys.length,
						rejectedEntries.map((r) => ({ field: r.field, reason: r.reason })),
					);

					turnNewValidFields = acceptedKeys;
					turnHadValidationRejects = rejectedEntries.length > 0;
				}

				if (turnResult?.status === "active") {
					const missingFields = turnResult.step.fields.filter((f) => !(f.key in turnResult.step.alreadyCollected));
					lastSuggestions = missingFields.flatMap((f) => f.suggestions || []);
				}
			}
		});

		try {
			await state.agent.prompt(enrichedPrompt);
			if (reply.trim()) replySource = "llm";
		} catch (err) {
			log.setError("llm_error", err);
		} finally {
			unsub();
		}

		// ---- Step 5: Post-process fallback (client only — admin doesn't need intent detection) ----
		if (state.role === "client" && psfState.status === "no_session" && !submitDataCalled) {
			const fallbackPackId = detectIntentFromText(msg.text);
			log.setFallback(fallbackPackId, false);

			if (fallbackPackId) {
				try {
					const turn = await this.config.psf.postTurn({
						requestId: msg.messageId,
						userId: msg.userId,
						channel: msg.channel,
						userText: msg.text,
						extractedPayload: {},
						packId: fallbackPackId,
					});

					if (turn.status === "active" && turn.step.uiHints?.suggestedPrompt) {
						reply = turn.step.uiHints.suggestedPrompt;
						const missingFields = turn.step.fields.filter((f) => !(f.key in turn.step.alreadyCollected));
						lastSuggestions = missingFields.flatMap((f) => f.suggestions || []);
						replySource = "fallback";
						log.setFallback(fallbackPackId, true);
					}
				} catch (err) {
					log.setError("fallback_submit_failed", err);
				}
			}
		}

		// ---- Step 6: Guardrails post-check ----
		const turnSignals: TurnSignals = {
			calledSubmit: submitDataCalled,
			newValidFields: turnNewValidFields,
			hadValidationRejects: turnHadValidationRejects,
		};
		const postCheck = state.guardrails.recordTurnResult(chatKey, currentStepId, turnSignals);
		if (postCheck.type !== "ok") {
			log.setGuardrailAction(postCheck);
		}
		if (postCheck.type === "force_escalation") {
			reply =
				"Похоже, у нас возникла сложность с этим шагом. " +
				"Попробуй написать /reset чтобы начать заново, или обратись в поддержку.";
			replySource = "guardrail";
		}

		// ---- Step 7: Fallback replies for empty responses ----
		if (!reply.trim() && lastPsfTurn?.status === "active") {
			reply = lastPsfTurn.step.uiHints?.suggestedPrompt || "Продолжим?";
			replySource = "runtime_default";
		}
		if (!reply.trim() && lastPsfTurn?.status === "terminal") {
			reply = "Готово! Ваша заявка принята.";
			replySource = "runtime_default";
		}

		// ---- Step 8: Log & send ----
		log.setReply(reply.trim().length, replySource);
		log.flush();

		if (reply.trim()) {
			const chunks = splitText(reply.trim(), 3900);
			for (let i = 0; i < chunks.length; i++) {
				const isLast = i === chunks.length - 1;
				await msg.sendText(chunks[i], isLast ? lastSuggestions : undefined);
			}
		}
	}

	// --------------------------------------------------------------------------
	// Per-chat Agent creation — role-aware
	// --------------------------------------------------------------------------

	private getOrCreateChat(msg: IncomingMessage): ChatState {
		const key = `${msg.channel}:${msg.chatId}`;
		let state = this.chats.get(key);

		if (!state) {
			const role = msg.role;

			// Mutable ref — tools read this to get current step for validation
			const stepRef: { current: TurnStep | undefined } = { current: undefined };
			const messageRef: { current: { messageId: string; userText: string } | undefined } = { current: undefined };
			const toolCtx: PsfToolsContext = {
				getCurrentStep: () => stepRef.current,
				getCurrentMessage: () => messageRef.current,
				bridge: this.config.bridge,
			};

			// Role-aware: prompt, tools, guardrails
			const systemPrompt = getSystemPrompt(role);
			const tools = getToolsForRole(role, this.config.psf, msg.userId, msg.channel, toolCtx);
			const guardrails = new ConversationGuardrails(getGuardrailConfigForRole(role));

			const model = getModel((this.config.provider ?? "anthropic") as any, this.config.model ?? "claude-sonnet-4-5");

			const agent = new Agent({
				initialState: {
					systemPrompt,
					model,
					thinkingLevel: "off",
					tools,
				},
				convertToLlm: (messages) =>
					messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult"),
				getApiKey: this.config.getApiKey,
			});

			state = {
				agent,
				busy: Promise.resolve(),
				role,
				guardrails,
				get currentStep() {
					return stepRef.current;
				},
				set currentStep(v) {
					stepRef.current = v;
				},
				get currentMessage() {
					return messageRef.current;
				},
				set currentMessage(v) {
					messageRef.current = v;
				},
			};
			this.chats.set(key, state);
		}

		return state;
	}

	// --------------------------------------------------------------------------
	// Reset a chat session (user sent /reset)
	// --------------------------------------------------------------------------

	async resetChat(chatId: string, channel: LindaChannel, userId: string): Promise<void> {
		const key = `${channel}:${chatId}`;
		const state = this.chats.get(key);
		if (state) {
			state.agent.reset();
			state.guardrails.reset(key);
		}
		await this.config.psf.resetSession({ userId, channel });
	}
}

// ============================================================================
// Helpers
// ============================================================================

function buildPsfContext(turn: TurnResponse, role: AgentRole): string {
	if (turn.status === "no_session") {
		if (role === "admin") {
			return `[PSF_STATE: no_session — you are an admin. Use admin tools to manage sessions or answer direct questions.]`;
		}
		return `[PSF_STATE: no_session — detect user's intent and call submit_data with the intent]`;
	}

	if (turn.status === "terminal") {
		return `[PSF_STATE: terminal — session complete]\n${JSON.stringify(turn.outcome, null, 2)}`;
	}

	const step = turn.step;
	const fields = step.fields
		.map((f) => `  - ${f.key}: ${f.label}${f.required ? " (required)" : ""}${f.hint ? ` — ${f.hint}` : ""}`)
		.join("\n");
	const collected =
		Object.keys(step.alreadyCollected).length > 0
			? `\nAlready collected: ${JSON.stringify(step.alreadyCollected)}`
			: "";
	const issue = turn.inputIssue ? `\n⚠️ Input issue: ${turn.inputIssue.message}` : "";
	const fieldKeys = step.fields.map((f) => f.key).join(", ");

	return `[PSF_STATE: active | step: ${step.id} | kind: ${step.kind ?? "collect"}]
Fields needed:
${fields}${collected}${issue}
⚡ When calling submit_data, use these EXACT key names in extractedPayload: ${fieldKeys}`;
}

function splitText(text: string, maxLen: number): string[] {
	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > maxLen) {
		const cut = remaining.lastIndexOf("\n", maxLen) || maxLen;
		chunks.push(remaining.slice(0, cut));
		remaining = remaining.slice(cut).trimStart();
	}
	if (remaining) chunks.push(remaining);
	return chunks;
}
