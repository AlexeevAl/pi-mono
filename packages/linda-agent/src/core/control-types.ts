import type { AdminChannel, ClientChannel, ClubChannel, LindaAgentRole } from "./types.js";

export type FirmStatus = "active" | "paused" | "disabled";
export type ControlledAgentStatus = "active" | "paused" | "disabled";
export type ControlledSessionStatus = "new" | "collecting" | "qualified" | "needs_human" | "booked" | "closed";

export type LocaleId = string;
export type SkillId = string;
export type ActionId = string;
export type StylePolicyId = string;
export type AuditEventId = string;
export type SessionId = string;
export type FirmId = string;
export type AgentId = string;
export type CustomerId = string;

export type EscalationReason =
	| "client_requested_human"
	| "client_angry_or_distrustful"
	| "forbidden_guarantee_requested"
	| "medical_risk"
	| "legal_risk"
	| "payment_risk"
	| "missing_required_data"
	| "low_agent_confidence"
	| "backend_data_unavailable"
	| "policy_block";

export type EscalationSeverity = "low" | "medium" | "high";
export type EscalationTarget = "admin_agent" | "human_operator" | "specialist";

export interface FirmRecord {
	firmId: FirmId;
	displayName: string;
	status: FirmStatus;
	activeSkillPackIds: string[];
	allowedChannels: ClubChannel[];
	allowedActions: ActionId[];
	defaultLocale: LocaleId;
	supportedLocales: LocaleId[];
}

export interface AgentRecord {
	agentId: AgentId;
	firmId: FirmId;
	role: LindaAgentRole;
	status: ControlledAgentStatus;
	allowedChannels: ClubChannel[];
	allowedSkillIds: SkillId[];
	allowedActions: ActionId[];
}

export type SkillFallbackBehavior = "ask_for_missing_data" | "handoff" | "block";

export interface SkillRecord {
	skillId: SkillId;
	name: string;
	description: string;
	allowedFor: LindaAgentRole[];
	requiredInputs: string[];
	outputSchemaId: string;
	permissions: ActionId[];
	forbiddenActions: ActionId[];
	auditLogRequired: boolean;
	fallbackBehavior: SkillFallbackBehavior;
}

export interface AgentActionSummary {
	actionId: ActionId;
	reason: string;
	createdAt: string;
}

export interface EscalationState {
	reason: EscalationReason;
	severity: EscalationSeverity;
	target: EscalationTarget;
	recommendedAction: string;
	createdAt: string;
}

export interface AgentSession {
	sessionId: SessionId;
	firmId: FirmId;
	customerId: CustomerId | null;
	channel: ClubChannel;
	status: ControlledSessionStatus;
	currentStep: string;
	activeSkillId: SkillId | null;
	collectedFields: Record<string, unknown>;
	missingFields: string[];
	lastAgentAction: AgentActionSummary | null;
	escalation: EscalationState | null;
	updatedAt: string;
}

export interface RedactionInstruction {
	path: string;
	reason: string;
}

export interface PolicyDecision {
	allowed: boolean;
	blockedReason?: string;
	requiredEscalation?: EscalationReason;
	requiredDisclaimers: string[];
	redactions: RedactionInstruction[];
	auditTags: string[];
}

export interface OperatorNotes {
	leadTemperature: "cold" | "warm" | "hot" | "risky";
	clientIntent: string;
	knownFacts: string[];
	missingInformation: string[];
	risks: string[];
	recommendedNextAction:
		| "ask_one_more_question"
		| "offer_consultation"
		| "call_client"
		| "doctor_review"
		| "price_confirmation"
		| "do_not_continue_automatically";
	suggestedOperatorMessage: string;
}

export interface EscalationNotice {
	sessionId: SessionId;
	firmId: FirmId;
	reason: EscalationReason;
	severity: EscalationSeverity;
	clientSummary: string;
	operatorNotes: OperatorNotes;
	recommendedAction: string;
}

export interface IncomingControlMessage {
	text: string;
	localeHint?: LocaleId;
	receivedAt: string;
}

export interface ControlTurnRequest {
	firmId: FirmId;
	agentId: AgentId;
	role: LindaAgentRole;
	channel: ClientChannel | AdminChannel;
	sessionId: SessionId;
	metadata?: Record<string, unknown>;
	incomingMessage: IncomingControlMessage;
}

export interface ControlTurnDecision {
	allowed: boolean;
	blockedReason?: string;
	firm: FirmRecord;
	agent: AgentRecord;
	session: AgentSession;
	activeSkillId: SkillId;
	allowedSkillIds: SkillId[];
	allowedActions: ActionId[];
	skillContext: Record<string, unknown>;
	requiredDisclaimers: string[];
	stylePolicyId: StylePolicyId;
	humanHandoff: boolean;
	handoffReason?: EscalationReason;
	auditEventId: AuditEventId;
}

export interface ProposedAction {
	actionId: ActionId;
	reason: string;
	payload: Record<string, unknown>;
}

export interface AgentTurnProposal {
	auditEventId: AuditEventId;
	sessionId: SessionId;
	agentId: AgentId;
	skillId: SkillId;
	clientMessage?: string;
	adminMessage?: string;
	proposedActions: ProposedAction[];
	extractedFields: Record<string, unknown>;
	operatorNotes?: OperatorNotes;
	confidence: number;
}

export interface ActionExecution {
	actionId: ActionId;
	auditEventId: AuditEventId;
	reason: string;
	payload: Record<string, unknown>;
}

export interface ControlPostCheckResult {
	allowed: boolean;
	blockedReason?: string;
	finalClientMessage?: string;
	finalAdminMessage?: string;
	executableActions: ActionExecution[];
	sessionPatch: Partial<AgentSession>;
	escalation?: EscalationNotice;
	auditEventId: AuditEventId;
}

export interface AuditEvent {
	eventId: AuditEventId;
	timestamp: string;
	firmId: FirmId;
	sessionId: SessionId;
	agentId: AgentId;
	channel: ClubChannel;
	skillCalled: SkillId | null;
	inputRef: string;
	outputRef: string | null;
	decisionReason: string;
	policyDecision: PolicyDecision;
	humanEscalation: EscalationNotice | null;
	actionExecuted: ActionExecution | null;
}
