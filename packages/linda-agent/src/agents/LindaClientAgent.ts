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

		// 1. Fetch context — backend is the source of truth
		const context = await this.backend.getAgentContext(input.clientId, reqOptions);

		// 2. Load persona
		const skillId = this.resolveSkillId(context);
		const skill = this.skills.getSkill(skillId);
		const systemPrompt = this.buildSystemPrompt(context, skill?.content);

		// 3. Assemble tools
		const tools = createClientTools(this.backend, input.clientId, reqOptions);

		// 4. Create runtime
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
			await agent.prompt(input.text);
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

		return `${persona}

## EXECUTION CONTEXT
- **Relationship State**: ${context.relationshipState}
- **Conversation Goal**: ${context.conversationGoal}
${context.nextBestAction ? `- **Suggested Next Action**: ${context.nextBestAction}` : ""}

## GUIDELINES
1. Align your tone with the current relationship state.
2. Focus on achieving the conversation goal.
3. Use tools only when needed to fulfill the goal.
4. Be concise, warm, and professional.
`;
	}
}
