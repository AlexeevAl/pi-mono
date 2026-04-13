import { ClinicBackendClient } from "../core/backend-client.js";
import { createAgent, extractTextContent } from "../core/base-agent.js";
import { SkillsLoader } from "../core/skills-loader.js";
import type { AdminDecideInput, AdminSkillId, AgentDecision, LindaRuntimeConfig } from "../core/types.js";
import { onToolExecutionEnd, onToolExecutionStart } from "../policies/shared-hooks.js";
import { createAdminTools } from "../tools/admin-tools.js";

/**
 * LindaAdminAgent — operational assistant for Telegram admin sessions.
 *
 * Role: admin_agent (hardcoded)
 * Channel default: telegram
 * Skills: admin_assistant, client_lookup, escalation_review
 * Tools: session management proxy tools
 *
 * Two operation modes:
 *  - Global: no targetClientId (list sessions, overview, SLA alerts)
 *  - Targeted: targetClientId set (view session, send message, override)
 *
 * Per-turn stateless: no local session state.
 */
export class LindaAdminAgent {
	private readonly backend: ClinicBackendClient;
	private readonly skills: SkillsLoader;
	private readonly config: LindaRuntimeConfig;

	constructor(config: LindaRuntimeConfig) {
		this.config = config;
		this.backend = new ClinicBackendClient(config.backend);
		this.skills = new SkillsLoader(config.shared.skillsDir);
	}

	public async decide(input: AdminDecideInput): Promise<AgentDecision> {
		// Guard: reject unauthorized admin actors
		const { allowedAdminIds } = this.config.adminAgent;
		if (allowedAdminIds.length > 0 && !allowedAdminIds.includes(input.adminId)) {
			return { reply: "Access denied: you are not authorized to use this interface." };
		}

		const channel = input.channel ?? this.config.adminAgent.defaults.channel;
		const role = "admin_agent" as const;
		const reqOptions = { role, channel };

		// 1. Load admin persona
		const skillId = this.resolveSkillId();
		const skill = this.skills.getSkill(skillId);
		const systemPrompt = this.buildSystemPrompt(skill?.content, input.targetClientId);

		// 2. Assemble admin tools
		const tools = createAdminTools(this.backend, reqOptions);

		// 3. Create runtime
		const agent = createAgent({
			llm: this.config.llm,
			systemPrompt,
			tools,
			getApiKey: async (provider) => process.env[`${provider.toUpperCase()}_API_KEY`],
		});

		// 4. Subscribe shared hooks
		const hookCtx = { agentRole: role, actorId: input.adminId, firmId: this.config.shared.firmId };
		const unsub = agent.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				onToolExecutionStart(event.toolName, event.args, hookCtx);
			} else if (event.type === "tool_execution_end") {
				onToolExecutionEnd(event.toolName, event.result, hookCtx);
			}
		});

		// 5. Run — inject context metadata into user message if needed
		const enrichedText = input.targetClientId
			? `[TARGET_CLIENT_ID: ${input.targetClientId}]\n${input.text}`
			: input.text;

		try {
			await agent.prompt(enrichedText);
		} finally {
			unsub();
		}

		// 6. Extract reply
		const lastMsg = agent.state.messages[agent.state.messages.length - 1];
		const reply = extractTextContent(lastMsg);

		return { reply };
	}

	private resolveSkillId(): AdminSkillId {
		const enabled = this.config.adminAgent.enabledSkills;
		// Primary admin skill is admin_assistant
		if (enabled.includes("admin_assistant")) return "admin_assistant";
		return enabled[0] ?? "admin_assistant";
	}

	private buildSystemPrompt(skillContent?: string, targetClientId?: string): string {
		const persona =
			skillContent ?? "# Linda Admin\nYou are Linda Admin — an operational assistant for clinic managers.";

		const targetBlock = targetClientId
			? `\n## CURRENT TARGET\n- **Client ID**: ${targetClientId}\n- Use view_session or other tools to fetch their details.`
			: "\n## MODE\n- Global admin mode: no specific client in scope. Use list_sessions to explore.";

		return `${persona}
${targetBlock}

## HARD LIMITS
- Never fabricate session data.
- Always require a reason for field overrides.
- Report errors honestly.
- Respond in the language the admin writes in.
`;
	}
}
