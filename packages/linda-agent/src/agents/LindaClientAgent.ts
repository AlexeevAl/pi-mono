import { ClinicBackendClient } from "../core/backend-client.js";
import { createAgent, extractTextContent } from "../core/base-agent.js";
import { SkillsLoader } from "../core/skills-loader.js";
import type {
	AgentDecision,
	ClientDecideInput,
	ClientSkillId,
	ClubAgentContext,
	LindaRuntimeConfig,
} from "../core/types.js";
import { onToolExecutionEnd, onToolExecutionStart } from "../policies/shared-hooks.js";
import { createClientTools } from "../tools/client-tools.js";

/**
 * LindaClientAgent — clinical assistant for WhatsApp interactions.
 *
 * Role: client_agent (hardcoded)
 * Channel default: whatsapp
 * Skills: profile_enrichment, manager, booking_consultation, etc.
 * Tools: clinical intake proxy tools
 *
 * Per-turn stateless: fetches fresh context from backend on every decide().
 */
export class LindaClientAgent {
	private readonly backend: ClinicBackendClient;
	private readonly skills: SkillsLoader;
	private readonly config: LindaRuntimeConfig;

	constructor(config: LindaRuntimeConfig) {
		this.config = config;
		this.backend = new ClinicBackendClient(config.backend);
		this.skills = new SkillsLoader(config.shared.skillsDir);
	}

	public async decide(input: ClientDecideInput): Promise<AgentDecision> {
		const channel = input.channel ?? this.config.clientAgent.defaults.channel;
		const role = "client_agent" as const;
		const reqOptions = { role, channel };

		console.log(`[Agent] Fetching context for client: ${input.clientId}...`);
		let context: ClubAgentContext;
		try {
			context = await this.backend.getAgentContext(input.clientId, reqOptions);
		} catch (err: any) {
			console.error(`[Agent] Failed to fetch context for client ${input.clientId}:`, err.message || err);
			throw err;
		}
		console.log(`[Agent] Context received. Active skill: ${context.activeSkill}`);

		const bookingConfirmation = this.resolveBookingConfirmation(input.text);
		if (bookingConfirmation) {
			console.log(`[Agent] Booking confirmation detected for client: ${input.clientId}`);
			await this.backend.patchClientProfile(
				input.clientId,
				{
					identityPatch: bookingConfirmation.identityPatch,
					profilePatch: bookingConfirmation.profilePatch,
					sourceType: "intake_answer",
					sourceRef: "linda_booking_confirmation",
				},
				reqOptions,
			);
			const updatedContext = await this.backend.getAgentContext(input.clientId, reqOptions);
			return {
				reply: this.buildBookingConfirmationReply(bookingConfirmation),
				context: updatedContext,
			};
		}

		// 2. Load persona
		const skillId = this.resolveSkillId(context);
		console.log(`[Agent] Using skill: ${skillId}`);
		const skill = this.skills.getSkill(skillId);
		const systemPrompt = this.buildSystemPrompt(context, skill?.content);

		// 3. Assemble tools
		const tools = createClientTools(this.backend, input.clientId, reqOptions, {
			allowEnrichmentLink: context.activeSkill === "profile_enrichment",
		});

		// 4. Create runtime
		console.log(
			`[Agent] Initializing LLM runtime. Provider: ${this.config.llm.provider}, Model: ${this.config.llm.model}`,
		);
		const agent = createAgent({
			llm: this.config.llm,
			systemPrompt,
			tools,
			getApiKey: async (provider) => process.env[`${provider.toUpperCase()}_API_KEY`],
		});

		// 5. Subscribe shared hooks
		const hookCtx = { agentRole: role, actorId: input.clientId, firmId: this.config.shared.firmId };
		const unsub = agent.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				onToolExecutionStart(event.toolName, event.args, hookCtx);
			} else if (event.type === "tool_execution_end") {
				onToolExecutionEnd(event.toolName, event.result, hookCtx);
			}
		});

		// 6. Run
		try {
			console.log(`[Agent] Prompting LLM with: "${input.text}"`);
			await agent.prompt(input.text);
			console.log(`[Agent] LLM response received.`);
		} catch (err: any) {
			console.error(`[Agent] LLM prompt error for client ${input.clientId}:`, err.message || err);
			if (err.stack) console.error(err.stack);
			throw err;
		} finally {
			unsub();
		}

		// 7. Extract reply
		const lastMsg = agent.state.messages[agent.state.messages.length - 1];
		const reply = extractTextContent(lastMsg);

		return { reply, context };
	}

	private resolveSkillId(context: ClubAgentContext): ClientSkillId {
		const skill = context.activeSkill;
		const enabled = this.config.clientAgent.enabledSkills;
		if (enabled.includes(skill)) return skill;
		// fallback to manager persona
		return "manager";
	}

	private buildSystemPrompt(context: ClubAgentContext, skillContent?: string): string {
		const persona =
			skillContent ?? "# Linda\nYou are Linda, a professional clinical manager and patient coordinator.";
		const personalization = this.config.clientAgent.personalization?.trim();

		return `${persona}
${personalization ? `\n## FIRM PERSONALIZATION\n${personalization}\n` : ""}

## EXECUTION CONTEXT
- **Relationship State**: ${context.relationshipState}
- **Conversation Goal**: ${context.conversationGoal}
${context.nextBestAction ? `- **Suggested Next Action**: ${context.nextBestAction}` : ""}

## GUIDELINES
1. Align your tone with the current relationship state.
2. Focus on achieving the conversation goal.
3. Use tools only when needed to fulfill the goal.
4. Be concise, warm, and professional.
5. If the active skill is not profile_enrichment, do not send another intake/enrichment link. Ask small follow-up questions in chat only when needed.
`;
	}

	private resolveBookingConfirmation(text: string) {
		const normalized = text.trim().toLowerCase();
		const hasBookingIntent =
			normalized.includes("подтверждаю запись") ||
			normalized.includes("хочу записаться") ||
			normalized.includes("запишите") ||
			normalized.includes("записаться");
		const hasSlot =
			/\b\d{1,2}[:.]\d{2}\b/.test(normalized) || normalized.includes("вторник") || normalized.includes("четверг");
		if (!hasBookingIntent || !hasSlot) {
			return undefined;
		}

		const fullName = this.extractName(text);
		const phone = this.extractPhone(text);
		const budgetLevel = normalized.includes("средн") ? "medium" : undefined;
		const appointmentWindow = this.extractAppointmentWindow(text);
		const nextStep = appointmentWindow ? `booking_confirmed:${appointmentWindow}` : "booking_confirmed";

		return {
			fullName,
			phone,
			appointmentWindow,
			identityPatch: {
				...(fullName ? { fullName } : {}),
				...(phone ? { phone } : {}),
				preferredChannel: "whatsapp",
			},
			profilePatch: {
				activeStatus: "booking_confirmed",
				nextStep,
				budgetLevel: budgetLevel ?? "medium",
				paymentCapacity: budgetLevel ?? "medium",
				motivationsJson: ["confirmed_booking_request"],
			},
		};
	}

	private extractName(text: string) {
		const match = /(?:имя|меня зовут)\s*[:-]?\s*([А-ЯA-ZЁ][А-ЯA-ZЁа-яa-zё\- ]{1,60})/iu.exec(text);
		return match?.[1]
			?.trim()
			.replace(/[.,;].*$/, "")
			.trim();
	}

	private extractPhone(text: string) {
		const match = /(?:\+?\d[\d\s().-]{7,}\d)/.exec(text);
		return match?.[0]?.replace(/[^\d+]/g, "");
	}

	private extractAppointmentWindow(text: string) {
		const dayMatch = /(понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)/i.exec(
			text,
		);
		const timeMatch = /\b(\d{1,2}[:.]\d{2})\b/.exec(text);
		const day = dayMatch?.[1]?.toLowerCase();
		const time = timeMatch?.[1]?.replace(".", ":");
		if (day && time) return `${day} ${time}`;
		return time ?? day;
	}

	private buildBookingConfirmationReply(input: { fullName?: string; phone?: string; appointmentWindow?: string }) {
		const nameLine = input.fullName ? `, ${input.fullName}` : "";
		const slot = input.appointmentWindow ?? "выбранный слот";
		const contact = input.phone ? ` Контакт для подтверждения: ${input.phone}.` : "";
		return `Готово${nameLine}: я зафиксировала запрос на запись на ${slot} в центральной локации.${contact}

До визита подготовьте список домашнего ухода, даты недавних процедур/пилингов и не используйте ретинол, кислоты или агрессивные скрабы за день до консультации. Администратор/врач увидит ваш профиль: чувствительная кожа, цель — мягкое улучшение тона и снижение покраснений, старт — консультация плюс одна щадящая процедура.`;
	}
}
