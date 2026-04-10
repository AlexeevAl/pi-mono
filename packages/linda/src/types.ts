// ============================================================================
// Linda — Core Types
// PSF ↔ Linda Protocol Contract
// ============================================================================

export type LindaChannel = "telegram" | "discord" | "whatsapp" | "tui" | "web";

// ----------------------------------------------------------------------------
// Agent Roles & Policies
// ----------------------------------------------------------------------------

/** Agent role determines prompt, tools, guardrails, and access scope */
export type AgentRole = "client" | "admin";

/** Policy object — runtime capabilities per role. Seam for future RBAC. */
export interface AgentPolicy {
	role: AgentRole;
	/** Can this agent see/manage sessions other than its own? */
	canViewAllSessions: boolean;
	/** Can this agent override field values on any session? */
	canOverrideFields: boolean;
	/** Can this agent send messages to clients? */
	canSendClientMessages: boolean;
	/** Is stuck detection / escalation active? (usually off for admin) */
	stuckDetectionEnabled: boolean;
	/** Override max turns per step (undefined = use default) */
	maxTurnsPerStep?: number;
	/** Access scope for PSF calls */
	sessionScope: "own" | "all";
}

/** Default policies per role */
export const AGENT_POLICIES: Record<AgentRole, AgentPolicy> = {
	client: {
		role: "client",
		canViewAllSessions: false,
		canOverrideFields: false,
		canSendClientMessages: false,
		stuckDetectionEnabled: true,
		sessionScope: "own",
	},
	admin: {
		role: "admin",
		canViewAllSessions: true,
		canOverrideFields: true,
		canSendClientMessages: true,
		stuckDetectionEnabled: false,
		maxTurnsPerStep: 20, // admin knows what they're doing
		sessionScope: "all",
	},
};

// ----------------------------------------------------------------------------
// Firm / Tenant Configuration
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Channel configs — typed per-role, not just "whatsapp: boolean"
// ----------------------------------------------------------------------------

/**
 * Client-facing channel (WhatsApp).
 * Handles intake: receives user messages, runs the client agent pipeline.
 */
export interface FirmClientChannel {
	enabled: boolean;
	/** Baileys session storage dir — required when enabled */
	authDir: string;
	/** Phone number whitelist. Empty = allow all. */
	allowedUserIds: string[];
}

/**
 * Operator-facing channel (Telegram).
 * Handles admin work: session browsing, overrides, messaging clients.
 * Has its own tool surface, relaxed guardrails, and "all" session scope.
 */
export interface FirmAdminChannel {
	enabled: boolean;
	/** Telegram bot token — required when enabled */
	botToken: string;
	/** Telegram user ID whitelist (numeric). Empty = allow all — not recommended for prod. */
	allowedUserIds: number[];
}

/**
 * Web chat channel.
 * HTTP server served by Linda itself — GET / serves the chat UI,
 * POST /chat is the message API.
 * Role configurable: default = "client".
 */
export interface FirmWebChannel {
	enabled: boolean;
	/** HTTP port Linda listens on (default: 3034) */
	port: number;
	/** Agent role for web sessions: "client" | "admin" (default: "client") */
	role: "client" | "admin";
	/** Allowed CORS origins, comma-separated. "*" = all. */
	allowedOrigins: string;
}

export interface FirmChannels {
	/** WhatsApp = client agent */
	whatsappClient: FirmClientChannel;
	/** Telegram = admin agent */
	telegramAdmin: FirmAdminChannel;
	/** Web chat = HTTP-served chat widget */
	webChat: FirmWebChannel;
}

/**
 * Per-firm configuration — loaded from env at startup.
 * One Linda instance = one firm. No runtime switching.
 *
 * Two operational contours:
 *   - channels.whatsappClient → intake, collect, guide (client role)
 *   - channels.telegramAdmin  → browse, override, message (admin role)
 */
export interface FirmConfig {
	/** Unique firm identifier (e.g. "acme_law", "pi_default") */
	id: string;
	/** Human-readable firm name — injected into system prompt */
	name: string;
	/**
	 * Allowed PSF pack IDs for this firm.
	 * Empty array = all packs allowed (useful for dev/single-firm setups).
	 */
	activePacks: string[];
	/**
	 * Default packId — skips intent detection entirely for single-scenario firms.
	 * Must be present in activePacks (or activePacks must be empty).
	 */
	defaultPackId?: string;
	/** UI/prompt language hint */
	language?: "ru" | "en" | "he";
	/** Conversation tone for system prompt */
	toneProfile?: "formal" | "warm" | "neutral";
	policies?: {
		/** Override max turns per step for this firm's clients */
		maxTurnsPerStep?: number;
		/** If true, guardrail escalation triggers human handoff flag in PSF */
		requireHumanHandoff?: boolean;
		/** Custom escalation message (overrides built-in guardrail text) */
		escalationMessage?: string;
	};
	/** Role-aware channel configuration */
	channels: FirmChannels;
}

// ----------------------------------------------------------------------------
// PSF Protocol — Request / Response shapes
// ----------------------------------------------------------------------------

export interface GetTurnRequest {
	userId: string;
	channel: LindaChannel;
	firmId: string;
}

export interface PostTurnRequest {
	requestId: string;
	userId: string;
	channel: LindaChannel;
	firmId: string;
	userText: string;
	extractedPayload: Record<string, unknown>;
	// Only needed when no session exists yet
	packId?: string;
	entryPoint?: string;
}

export interface ResetSessionRequest {
	userId: string;
	channel: LindaChannel;
	firmId: string;
}

// ----------------------------------------------------------------------------
// PSF Protocol — TurnResponse (one shape for GET and POST)
// ----------------------------------------------------------------------------

export interface StepField {
	key: string;
	label: string;
	hint?: string;
	required: boolean;
	suggestions?: string[];
}

export interface TurnStep {
	id: string;
	kind?: "collect" | "confirm" | "choose" | "inform";
	fields: StepField[];
	alreadyCollected: Record<string, unknown>;
	uiHints?: {
		allowCombinedAnswer?: boolean;
		suggestedPrompt?: string;
	};
}

export interface TurnOutcome {
	reportUrl?: string;
	handoffTriggered: boolean;
}

export interface TurnInputIssue {
	code: "missing_fields" | "invalid_value" | "ambiguous" | "conflict";
	missingFields?: string[];
	message: string;
}

export type TurnResponse =
	| {
			status: "no_session";
			sessionId: null;
	  }
	| {
			status: "active";
			sessionId: string;
			step: TurnStep;
			inputIssue?: TurnInputIssue;
	  }
	| {
			status: "terminal";
			sessionId: string;
			outcome: TurnOutcome;
	  };

// ----------------------------------------------------------------------------
// Channel adapter contract — what Linda needs from each channel
// ----------------------------------------------------------------------------

export interface ChannelMessage {
	messageId: string;
	userId: string;
	chatId: string;
	userName?: string;
	text: string;
	timestamp: number;
	channel: LindaChannel;
}

export interface ChannelAdapter {
	readonly channel: LindaChannel;
	sendText(chatId: string, text: string): Promise<void>;
	sendTyping(chatId: string): Promise<void>;
	start(): Promise<void>;
	stop(): void;
}

// ----------------------------------------------------------------------------
// ChatQueue — per-chat sequential processing (same pattern as pi-mom)
// ----------------------------------------------------------------------------

export type ChatHandler = (message: ChannelMessage) => Promise<void>;

// ----------------------------------------------------------------------------
// Admin Tools — Phase 2 API Contract
// ----------------------------------------------------------------------------

export interface AdminListSessionsRequest {
	firmId: string;
	status?: "active" | "terminal" | "all";
	limit?: number;
}

export interface SessionSummary {
	sessionId: string;
	userId: string;
	channel: LindaChannel;
	actorId?: string;
	firmId?: string;
	clientName?: string;
	currentStepId?: string;
	status: "active" | "terminal";
	lastActivityAt: string;
}

export interface AdminViewSessionRequest {
	sessionId: string;
	firmId: string;
}

export interface SessionDetail extends SessionSummary {
	actorId?: string;
	firmId?: string;
	collectedData: Record<string, unknown>;
	history: Array<{
		ts: string;
		event: string;
		data?: any;
	}>;
}

export interface AdminAddNoteRequest {
	sessionId: string;
	note: string;
}

export interface AdminOverrideFieldRequest {
	sessionId: string;
	fieldKey: string;
	newValue: unknown;
	reason: string;
}

export interface AdminSendMessageRequest {
	sessionId: string;
	message: string;
}

// ----------------------------------------------------------------------------
// Bridge — direct message delivery to clients from admins
// ----------------------------------------------------------------------------

export interface LindaBridge {
	readonly name: string;
	canHandle(actorId: string): boolean;
	sendDirectMessage(actorId: string, text: string): Promise<boolean>;
}

export class BridgeRegistry {
	private bridges: LindaBridge[] = [];

	register(bridge: LindaBridge) {
		this.bridges.push(bridge);
	}

	async send(actorId: string, text: string): Promise<boolean> {
		for (const bridge of this.bridges) {
			if (bridge.canHandle(actorId)) {
				return await bridge.sendDirectMessage(actorId, text);
			}
		}
		return false;
	}
}
