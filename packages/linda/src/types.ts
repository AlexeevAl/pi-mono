// ============================================================================
// Linda — Core Types
// PSF ↔ Linda Protocol Contract
// ============================================================================

export type LindaChannel = "telegram" | "discord" | "whatsapp" | "tui";

// ----------------------------------------------------------------------------
// PSF Protocol — Request / Response shapes
// ----------------------------------------------------------------------------

export interface GetTurnRequest {
	userId: string;
	channel: LindaChannel;
}

export interface PostTurnRequest {
	requestId: string;
	userId: string;
	channel: LindaChannel;
	userText: string;
	extractedPayload: Record<string, unknown>;
	// Only needed when no session exists yet
	packId?: string;
	entryPoint?: string;
}

export interface ResetSessionRequest {
	userId: string;
	channel: LindaChannel;
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
