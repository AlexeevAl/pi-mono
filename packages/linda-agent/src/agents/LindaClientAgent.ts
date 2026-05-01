import { ClinicBackendClient } from "../core/backend-client.js";
import { createAgent, extractTextContent } from "../core/base-agent.js";
import { ControlBackendClient } from "../core/control-client.js";
import type { ActionExecution } from "../core/control-types.js";
import { SkillsLoader } from "../core/skills-loader.js";
import type {
	AgentDecision,
	ClientDecideInput,
	ClientSkillId,
	ClubAgentContext,
	LindaRuntimeConfig,
} from "../core/types.js";
import { onToolExecutionEnd, onToolExecutionStart } from "../policies/shared-hooks.js";
import { resolveClientSkillProposal } from "../skills/client-skill-proposals.js";
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
	private readonly control: ControlBackendClient;
	private readonly skills: SkillsLoader;
	private readonly config: LindaRuntimeConfig;

	constructor(config: LindaRuntimeConfig) {
		this.config = config;
		this.backend = new ClinicBackendClient(config.backend);
		this.control = new ControlBackendClient(config.backend);
		this.skills = new SkillsLoader(config.shared.skillsDir);
	}

	public async decide(input: ClientDecideInput): Promise<AgentDecision> {
		const channel = input.channel ?? this.config.clientAgent.defaults.channel;
		const role = "client_agent" as const;
		const reqOptions = { role, channel };

		const control = await this.control.precheckTurn({
			firmId: this.config.shared.firmId,
			agentId: `${this.config.shared.firmId}:client_agent`,
			role,
			channel,
			sessionId: input.clientId,
			incomingMessage: {
				text: input.text,
				receivedAt: new Date().toISOString(),
			},
		});
		if (!control.allowed) {
			return {
				reply: "Лучше передам это администратору, чтобы не дать неточную информацию.",
			};
		}

		console.log(`[Agent] Fetching context for client: ${input.clientId}...`);
		let context: ClubAgentContext;
		try {
			context = await this.backend.getAgentContext(input.clientId, reqOptions);
		} catch (err: any) {
			console.error(`[Agent] Failed to fetch context for client ${input.clientId}:`, err.message || err);
			throw err;
		}
		console.log(`[Agent] Context received. Active skill: ${context.activeSkill}`);

		const effectiveContext = this.applyControlDecision(context, control);

		if (this.isApprovalStatusQuestion(input.text)) {
			const profileResponse = await this.backend.getClientProfile(input.clientId, reqOptions);
			const approval = this.resolveApprovedAppointmentStatus(profileResponse);
			if (approval) {
				const reply = this.buildAppointmentApprovedReply(approval);
				const checkedReply = await this.postcheckClientReply({
					auditEventId: control.auditEventId,
					clientId: input.clientId,
					skillId: effectiveContext.activeSkill,
					reply,
					reqOptions,
				});
				return {
					reply: checkedReply,
					context: effectiveContext,
				};
			}
		}

		const selectedSkillProposal = resolveClientSkillProposal({
			text: input.text,
			context: effectiveContext,
			auditEventId: control.auditEventId,
			sessionId: input.clientId,
			agentId: `${this.config.shared.firmId}:client_agent`,
		});
		if (selectedSkillProposal) {
			console.log(`[Agent] Selected skill proposal created: ${effectiveContext.activeSkill}`);
			const postcheck = await this.control.postcheckTurn(selectedSkillProposal.proposal, reqOptions);
			if (
				!postcheck.allowed ||
				!this.allProposedActionsApproved(selectedSkillProposal.proposal, postcheck.executableActions)
			) {
				return {
					reply:
						postcheck.finalClientMessage ??
						"Лучше передам это администратору, чтобы не дать неточную информацию.",
					context: effectiveContext,
				};
			}

			await this.executeApprovedClientActions(input.clientId, postcheck.executableActions, reqOptions);
			const updatedContext = await this.backend.getAgentContext(input.clientId, reqOptions);
			return {
				reply: postcheck.finalClientMessage ?? selectedSkillProposal.reply,
				context: updatedContext,
			};
		}

		// 2. Load persona
		const skillId = this.resolveSkillId(effectiveContext);
		console.log(`[Agent] Using skill: ${skillId}`);
		const skill = this.skills.getSkill(skillId);
		const systemPrompt = this.buildSystemPrompt(effectiveContext, skill?.content);

		// 3. Assemble tools
		const tools = createClientTools(this.backend, input.clientId, reqOptions, {
			allowEnrichmentLink: effectiveContext.activeSkill === "profile_enrichment",
			control: this.control,
			auditEventId: control.auditEventId,
			agentId: `${this.config.shared.firmId}:client_agent`,
			skillId,
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
		const checkedReply = await this.postcheckClientReply({
			auditEventId: control.auditEventId,
			clientId: input.clientId,
			skillId,
			reply,
			reqOptions,
		});

		return { reply: checkedReply, context: effectiveContext };
	}

	private async postcheckClientReply(input: {
		auditEventId: string;
		clientId: string;
		skillId: ClientSkillId;
		reply: string;
		reqOptions: { role: "client_agent"; channel: "whatsapp" | "web" };
	}) {
		const postcheck = await this.control.postcheckTurn(
			{
				auditEventId: input.auditEventId,
				sessionId: input.clientId,
				agentId: `${this.config.shared.firmId}:client_agent`,
				skillId: input.skillId,
				clientMessage: input.reply,
				proposedActions: [],
				extractedFields: {},
				confidence: 0.8,
			},
			input.reqOptions,
		);
		return postcheck.finalClientMessage ?? input.reply;
	}

	private allProposedActionsApproved(
		proposal: { proposedActions: Array<{ actionId: string }> },
		executableActions: ActionExecution[],
	) {
		return proposal.proposedActions.every((proposedAction) =>
			executableActions.some((executableAction) => executableAction.actionId === proposedAction.actionId),
		);
	}

	private async executeApprovedClientActions(
		clientId: string,
		actions: ActionExecution[],
		reqOptions: { role: "client_agent"; channel: "whatsapp" | "web" },
	) {
		for (const action of actions) {
			if (action.actionId === "update_lead_fields") {
				await this.backend.patchClientProfile(clientId, action.payload, reqOptions);
			}
		}
	}

	private applyControlDecision(
		context: ClubAgentContext,
		control: { activeSkillId: string; allowedSkillIds: string[]; skillContext: Record<string, unknown> },
	): ClubAgentContext {
		const activeSkill = this.resolveControlSkillId(control.activeSkillId, context.activeSkill);
		return {
			...context,
			activeSkill,
			allowedSkills: this.resolveAllowedControlSkills(control.allowedSkillIds, context.allowedSkills),
			conversationGoal: activeSkill === "booking_consultation" ? "book_consultation" : context.conversationGoal,
			skillContext: control.skillContext,
		};
	}

	private resolveAllowedControlSkills(controlSkillIds: string[], fallback: ClientSkillId[]) {
		const result = controlSkillIds
			.map((skillId) => this.resolveControlSkillId(skillId, undefined))
			.filter((skillId): skillId is ClientSkillId => Boolean(skillId));
		return result.length > 0 ? result : fallback;
	}

	private resolveControlSkillId(skillId: string, fallback: ClientSkillId | undefined): ClientSkillId {
		if (this.isClientSkillId(skillId)) {
			return skillId;
		}
		return fallback ?? "manager";
	}

	private isClientSkillId(skillId: string): skillId is ClientSkillId {
		return [
			"problem_discovery",
			"profile_enrichment",
			"service_recommendation",
			"booking_consultation",
			"post_procedure_checkin",
			"reactivation",
			"membership_offer",
			"annual_plan_tracking",
			"objection_handling",
			"human_handoff",
			"manager",
			"none",
		].includes(skillId);
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

	private isApprovalStatusQuestion(text: string) {
		const normalized = text.trim().toLowerCase();
		const asksStatus =
			normalized.includes("статус") ||
			normalized.includes("подтвержд") ||
			normalized.includes("утвержд") ||
			normalized.includes("просмотр");
		const aboutBooking = normalized.includes("запис") || normalized.includes("визит") || normalized.includes("прием");
		return asksStatus && aboutBooking;
	}

	private resolveApprovedAppointmentStatus(profileResponse: unknown) {
		const root = this.asRecord(profileResponse);
		const profile = this.asRecord(root.profile);
		const client = this.asRecord(root.client);
		const activeStatus = this.stringValue(profile.activeStatus);
		const nextStep = this.stringValue(profile.nextStep);
		const doctorRecommendation = this.stringValue(profile.doctorRecommendation);
		const doctorId = this.stringValue(client.assignedDoctorId);
		if (activeStatus !== "appointment_approved" && !nextStep?.startsWith("appointment_approved")) {
			return undefined;
		}

		const appointmentWindow = nextStep?.startsWith("appointment_approved:")
			? nextStep.slice("appointment_approved:".length).trim()
			: undefined;
		return {
			appointmentWindow,
			doctorId,
			doctorRecommendation,
		};
	}

	private buildAppointmentApprovedReply(input: {
		appointmentWindow?: string;
		doctorId?: string;
		doctorRecommendation?: string;
	}) {
		const slot = input.appointmentWindow ? ` на ${this.formatAppointmentWindow(input.appointmentWindow)}` : "";
		const doctor = input.doctorId ? ` Врач: ${input.doctorId}.` : "";
		const recommendation =
			input.doctorRecommendation && !/просмотрена|утверждена|подтверждена/i.test(input.doctorRecommendation)
				? ` ${input.doctorRecommendation}`
				: "";
		return `Да, ваша запись${slot} просмотрена администратором и утверждена.${doctor}${recommendation}`;
	}

	private formatAppointmentWindow(value: string) {
		return value.replace(
			/^(понедельник|вторник|среда|среду|четверг|пятница|пятницу|суббота|субботу|воскресенье)(?=\s|$)/i,
			(day) => this.normalizeAppointmentDay(day),
		);
	}

	private normalizeAppointmentDay(day: string) {
		const normalized = day.toLowerCase();
		const byDay: Record<string, string> = {
			понедельник: "понедельник",
			вторник: "вторник",
			среда: "среду",
			среду: "среду",
			четверг: "четверг",
			пятница: "пятницу",
			пятницу: "пятницу",
			суббота: "субботу",
			субботу: "субботу",
			воскресенье: "воскресенье",
		};
		return byDay[normalized] ?? normalized;
	}

	private asRecord(value: unknown) {
		return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	}

	private stringValue(value: unknown) {
		return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
	}
}
