// ============================================================================
// Linda Agent — Shared Type System
// ============================================================================

// --- Channel & Role ---

export type ClubChannel = "whatsapp" | "telegram" | "web";
export type ClientChannel = "whatsapp" | "web";
export type AdminChannel = "telegram" | "web";

export type LindaAgentRole = "client_agent" | "admin_agent";

// --- Backend Domain Types ---

export type ClubRelationshipState =
	| "new_client"
	| "profile_incomplete"
	| "active_client"
	| "high_intent"
	| "post_procedure"
	| "reactivation_candidate"
	| "vip_member"
	| "human_followup_needed";

export type ClubConversationGoal =
	| "clarify_need"
	| "complete_profile"
	| "recommend_service"
	| "track_annual_plan"
	| "book_consultation"
	| "post_treatment_checkin"
	| "reactivate_client"
	| "sell_membership"
	| "handle_objection"
	| "handoff_to_human";

export type ClientSkillId =
	| "problem_discovery"
	| "profile_enrichment"
	| "service_recommendation"
	| "booking_consultation"
	| "post_procedure_checkin"
	| "reactivation"
	| "membership_offer"
	| "annual_plan_tracking"
	| "objection_handling"
	| "human_handoff"
	| "manager"
	| "none";

export type AdminSkillId =
	| "admin_assistant"
	| "client_lookup"
	| "profile_review"
	| "manual_followup"
	| "escalation_review";

export interface ClubAgentContext {
	tenantId: string;
	clientId: string;
	channel: ClubChannel;
	relationshipState: ClubRelationshipState;
	conversationGoal: ClubConversationGoal;
	activeSkill: ClientSkillId;
	allowedSkills: ClientSkillId[];
	nextBestAction?: string;
	skillContext?: unknown;
}

// --- Unified Runtime Config ---

export interface BackendConfig {
	baseUrl: string;
	sharedSecret: string;
	edgeId: string;
	firmId: string;
}

export interface LlmConfig {
	provider: string;
	model: string;
}

export interface SharedAgentConfig {
	firmId: string;
	locale: string;
	skillsDir: string;
	remoteRuntime?: AgentRuntimeConfig;
}

export interface ClientAgentConfig {
	enabled: boolean;
	enabledSkills: ClientSkillId[];
	profileId?: string;
	personalization?: string;
	channels: Record<ClientChannel, boolean>;
	defaults: {
		channel: ClientChannel;
	};
}

export interface AdminAgentConfig {
	enabled: boolean;
	enabledSkills: AdminSkillId[];
	allowedAdminIds: string[];
	profileId?: string;
	personalization?: string;
	channels: Record<AdminChannel, boolean>;
	defaults: {
		channel: AdminChannel;
	};
}

export interface LindaRuntimeConfig {
	backend: BackendConfig;
	llm: LlmConfig;
	shared: SharedAgentConfig;
	clientAgent: ClientAgentConfig;
	adminAgent: AdminAgentConfig;
}

// --- Firm runtime config fetched from psf-engine-v2 ---

export type FirmAgentChannel = "web" | "whatsapp" | "telegram" | "ops";

export interface FirmAgentBinding {
	enabled: boolean;
	profileId: string;
	personalization?: string;
	channels: Record<FirmAgentChannel, boolean>;
}

export interface FirmAgentRuntimeConfig {
	clientAgent: FirmAgentBinding;
	firmAgent: FirmAgentBinding;
}

export interface AgentRuntimeConfig {
	firmId: string;
	locale?: string;
	intakeEnabled: boolean;
	clubEnabled: boolean;
	defaultChannel?: string;
	defaultDoctorAssignmentMode?: string;
	agentRuntime: FirmAgentRuntimeConfig;
	clinicCatalog: {
		enabled: boolean;
		itemCount: number;
	};
	generatedAt?: string;
}

// --- Decide Inputs / Outputs ---

/** Base internal representation — both agents map their inputs to this */
export interface BaseDecideInput {
	actorId: string;
	actorRole: LindaAgentRole;
	text: string;
	channel: ClubChannel;
	targetClientId?: string;
	metadata?: Record<string, unknown>;
}

/** Public input for LindaClientAgent */
export interface ClientDecideInput {
	clientId: string;
	text: string;
	channel?: ClientChannel;
	metadata?: Record<string, unknown>;
}

/** Public input for LindaAdminAgent */
export interface AdminDecideInput {
	adminId: string;
	text: string;
	channel?: AdminChannel;
	/** Optional — admins can act without a specific client in scope */
	targetClientId?: string;
	/** For multi-turn admin sessions */
	threadId?: string;
	metadata?: Record<string, unknown>;
}

export interface AgentDecision {
	reply: string;
	context?: ClubAgentContext;
}

// --- Legacy compat ---

/** @deprecated Use LindaRuntimeConfig instead */
export interface LindaAgentConfig {
	baseUrl: string;
	firmId: string;
	bridgeSharedSecret?: string;
	edgeId?: string;
	defaultChannel?: ClubChannel;
	timeoutMs?: number;
	skillsDir: string;
}
