// ============================================================================
// Linda — Bot
// One Agent per chatId. pi-agent-core handles all state and event streaming.
// ============================================================================

import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { LINDA_SYSTEM_PROMPT } from "./prompt.js";
import type { PsfClient } from "./psf.js";
import { createPsfTools } from "./tools.js";
import type { LindaChannel, TurnResponse } from "./types.js";

export interface LindaBotConfig {
	psf: PsfClient;
	model?: string;
	provider?: string;
	getApiKey: (provider: string) => Promise<string | undefined>;
}

export interface IncomingMessage {
	messageId: string;
	chatId: string;
	userId: string;
	text: string;
	channel: LindaChannel;
	sendText: (text: string, suggestions?: string[]) => Promise<void>;
	sendTyping: () => Promise<void>;
}

// ============================================================================
// Per-chat state
// ============================================================================

interface ChatState {
	agent: Agent;
	busy: Promise<void>;
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
		state.busy = state.busy.then(() => this.process(msg, state.agent));
		await state.busy;
	}

	// --------------------------------------------------------------------------
	// Process one message with the chat's Agent
	// --------------------------------------------------------------------------

	private async process(msg: IncomingMessage, agent: Agent): Promise<void> {
		await msg.sendTyping().catch(() => {});

		let reply = "";
		let lastSuggestions: string[] = [];

		// Collect streaming text and log tools
		const unsub = agent.subscribe(async (event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				reply += event.assistantMessageEvent.delta;
			} else if (event.type === "tool_execution_start") {
				console.log(`[Linda] 🛠️  Call: ${event.toolName}(${JSON.stringify(event.args)})`);
			} else if (event.type === "tool_execution_end") {
				console.log(`[Linda] ✅  Result: ${event.toolName} ${event.isError ? "FAILED" : "OK"}`);

				// Extract PSF suggestions from the turn info
				const turnResult = (event.result as any)?.details?.turn as TurnResponse | undefined;
				if (turnResult?.status === "active") {
					lastSuggestions = turnResult.step.fields.flatMap((f) => f.suggestions || []);
				}

				if (event.toolName === "get_current_step" && !event.isError) {
					console.log(
						`[Linda] 📦 Turn info: ${JSON.stringify(event.result.details?.turn || event.result, null, 2)}`,
					);
				}
			} else if (event.type === "agent_start") {
				console.log(`[Linda] 🤖 Processing msg for ${msg.userId}...`);
			}
		});

		try {
			await agent.prompt(`[MESSAGE_ID: ${msg.messageId}] ${msg.text}`);
		} finally {
			unsub();
		}

		if (reply.trim()) {
			// Split long replies (Telegram limit: 4096 chars)
			const chunks = splitText(reply.trim(), 3900);
			for (let i = 0; i < chunks.length; i++) {
				const isLast = i === chunks.length - 1;
				await msg.sendText(chunks[i], isLast ? lastSuggestions : undefined);
			}
		}
	}

	// --------------------------------------------------------------------------
	// Per-chat Agent creation
	// --------------------------------------------------------------------------

	private getOrCreateChat(msg: IncomingMessage): ChatState {
		const key = `${msg.channel}:${msg.chatId}`;
		let state = this.chats.get(key);

		if (!state) {
			const tools = createPsfTools(this.config.psf, msg.userId, msg.channel);
			const model = getModel((this.config.provider ?? "anthropic") as any, this.config.model ?? "claude-sonnet-4-5");

			const agent = new Agent({
				initialState: {
					systemPrompt: LINDA_SYSTEM_PROMPT,
					model,
					thinkingLevel: "off",
					tools,
				},
				convertToLlm: (messages) =>
					messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult"),
				getApiKey: this.config.getApiKey,
			});

			state = { agent, busy: Promise.resolve() };
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
		}
		await this.config.psf.resetSession({ userId, channel });
	}
}

// ============================================================================
// Helpers
// ============================================================================

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
