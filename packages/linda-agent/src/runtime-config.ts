import type { AdminSkillId, AgentRuntimeConfig, ClientSkillId, LindaRuntimeConfig } from "./core/types.js";

const CLIENT_SKILL_IDS = new Set<ClientSkillId>([
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
]);

const ADMIN_SKILL_IDS = new Set<AdminSkillId>([
	"admin_assistant",
	"client_lookup",
	"profile_review",
	"manual_followup",
	"escalation_review",
]);

export function applyAgentRuntimeConfig(config: LindaRuntimeConfig, remote: AgentRuntimeConfig): LindaRuntimeConfig {
	const clientProfileId = asClientSkillId(remote.agentRuntime.clientAgent.profileId);
	const adminProfileId = asAdminSkillId(remote.agentRuntime.firmAgent.profileId);
	const defaultClientChannel =
		remote.defaultChannel === "web" || remote.defaultChannel === "whatsapp"
			? remote.defaultChannel
			: config.clientAgent.defaults.channel;

	return {
		...config,
		shared: {
			...config.shared,
			locale: normalizeLocale(remote.locale) ?? config.shared.locale,
			remoteRuntime: remote,
		},
		clientAgent: {
			...config.clientAgent,
			enabled: remote.agentRuntime.clientAgent.enabled,
			enabledSkills: clientProfileId
				? dedupe([...config.clientAgent.enabledSkills, clientProfileId])
				: config.clientAgent.enabledSkills,
			profileId: remote.agentRuntime.clientAgent.profileId,
			personalization: remote.agentRuntime.clientAgent.personalization,
			channels: {
				whatsapp: remote.agentRuntime.clientAgent.channels.whatsapp,
				web: remote.agentRuntime.clientAgent.channels.web,
			},
			defaults: {
				channel: defaultClientChannel,
			},
		},
		adminAgent: {
			...config.adminAgent,
			enabled: remote.agentRuntime.firmAgent.enabled,
			enabledSkills: adminProfileId
				? dedupe([...config.adminAgent.enabledSkills, adminProfileId])
				: config.adminAgent.enabledSkills,
			profileId: remote.agentRuntime.firmAgent.profileId,
			personalization: remote.agentRuntime.firmAgent.personalization,
			channels: {
				telegram: remote.agentRuntime.firmAgent.channels.telegram,
				web: remote.agentRuntime.firmAgent.channels.web || remote.agentRuntime.firmAgent.channels.ops,
			},
		},
	};
}

function asClientSkillId(value: string): ClientSkillId | undefined {
	return CLIENT_SKILL_IDS.has(value as ClientSkillId) ? (value as ClientSkillId) : undefined;
}

function asAdminSkillId(value: string): AdminSkillId | undefined {
	return ADMIN_SKILL_IDS.has(value as AdminSkillId) ? (value as AdminSkillId) : undefined;
}

function normalizeLocale(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	return trimmed.split("-")[0]?.toLowerCase();
}

function dedupe<T>(values: T[]): T[] {
	return Array.from(new Set(values));
}
