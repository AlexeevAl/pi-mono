// ============================================================================
// Linda — Structured Logger
//
// Every turn produces a typed TurnLog entry with full forensic context.
// No external deps — JSON to stdout. Plug in any log drain later.
// ============================================================================

import type { GuardrailAction } from "./guardrails.js";
import { redactForLog } from "./redact.js";
import type { AgentRole, LindaChannel, TurnResponse } from "./types.js";
import type { ValidationRejectReason } from "./validation.js";

// ----------------------------------------------------------------------------
// Enums / types for classification
// ----------------------------------------------------------------------------

/** Who produced the final reply */
export type ReplySource = "llm" | "fallback" | "guardrail" | "runtime_default" | "none";

/** Normalized outcome of this turn */
export type EffectiveOutcome =
	| "progressed" // PSF moved to a new step
	| "stayed_same_step" // still on same step, but data accepted
	| "validation_blocked" // payload cleaned resulted in no data
	| "input_issue" // PSF returned inputIssue
	| "guardrail_escalated" // guardrail took over
	| "fallback_used" // runtime fallback detected intent
	| "no_session_pending" // waiting for intent, nothing happened
	| "session_started" // new session created
	| "completed" // terminal state reached
	| "error"; // something broke

// ----------------------------------------------------------------------------
// Log entry shape — one per user message processed
// ----------------------------------------------------------------------------

export interface TurnLog {
	/** ISO timestamp */
	ts: string;
	/** Log level */
	level: "info" | "warn" | "error";
	/** Event name for filtering */
	event: "turn";
	/** Unique turn ID (messageId is unique per turn) */
	turnId: string;
	/** PSF session ID (if known) */
	sessionId: string | null;

	/** User / chat identifiers */
	userId: string;
	chatId: string;
	channel: LindaChannel;
	/** Message that triggered this turn */
	messageId: string;
	/** Agent role */
	role: AgentRole;

	/** PSF state BEFORE LLM ran */
	psfStatus: "no_session" | "active" | "terminal" | "error";
	/** Current step ID (if active) */
	stepId?: string;

	/** What the LLM did */
	llm: {
		/** Did LLM call submit_data? */
		calledSubmit: boolean;
		/** Intent sent by LLM (if no_session) */
		intent?: string;
		/** Fields extracted (keys only, no PII) */
		extractedFields?: string[];
		/** Reply length in chars */
		replyLength: number;
	};

	/** Who produced the final reply */
	replySource: ReplySource;

	/** Normalized turn outcome */
	effectiveOutcome: EffectiveOutcome;

	/** Runtime fallback actions */
	fallback?: {
		intentDetection: boolean;
		packId?: string;
		replyInjected: boolean;
	};

	/** Guardrail action taken (if any) */
	guardrailAction?: GuardrailAction["type"];

	/** Validation summary (no PII) */
	validation?: {
		/** Number of fields that passed */
		acceptedCount: number;
		/** Rejected fields with reason codes */
		rejected: Array<{ field: string; reason: ValidationRejectReason }>;
	};

	/** PSF result AFTER submit (if any) */
	psfResult?: {
		status: string;
		inputIssue?: string;
		stepId?: string;
	};

	/** Timing */
	durationMs: number;
	/** Error code for programmatic filtering */
	errorCode?: string;
	/** Error details (human readable) */
	error?: string;
}

// ----------------------------------------------------------------------------
// Error codes
// ----------------------------------------------------------------------------

export type ErrorCode =
	| "psf_unreachable"
	| "psf_submit_failed"
	| "unknown_intent"
	| "fallback_submit_failed"
	| "guardrail_escalation"
	| "llm_error"
	| "unknown";

// ----------------------------------------------------------------------------
// Logger class — accumulates data during a turn, then flushes
// ----------------------------------------------------------------------------

export class TurnLogger {
	private entry: Partial<TurnLog>;
	private startTime: number;
	private initialStepId?: string;

	constructor(msg: { messageId: string; userId: string; chatId: string; channel: LindaChannel; role: AgentRole }) {
		this.startTime = Date.now();
		this.entry = {
			ts: new Date().toISOString(),
			level: "info",
			event: "turn",
			turnId: msg.messageId,
			sessionId: null,
			userId: redactForLog(msg.userId, "userId"),
			chatId: redactForLog(msg.chatId, "chatId"),
			channel: msg.channel,
			messageId: msg.messageId,
			role: msg.role,
			replySource: "none",
			effectiveOutcome: "error", // default, overridden before flush
			llm: {
				calledSubmit: false,
				replyLength: 0,
			},
		};
	}

	/** Set PSF state before LLM */
	setPsfState(turn: TurnResponse): void {
		this.entry.psfStatus = turn.status;
		if (turn.status === "active") {
			this.entry.stepId = turn.step.id;
			this.entry.sessionId = turn.sessionId;
			this.initialStepId = turn.step.id;
		} else if (turn.status === "terminal") {
			this.entry.sessionId = turn.sessionId;
		}
	}

	/** PSF pre-call failed */
	setPsfError(err: unknown): void {
		this.entry.psfStatus = "error";
		this.entry.level = "error";
		this.entry.errorCode = "psf_unreachable";
		this.entry.error = err instanceof Error ? err.message : String(err);
		this.entry.effectiveOutcome = "error";
	}

	/** LLM called submit_data */
	setSubmitCalled(args: Record<string, unknown>): void {
		this.entry.llm!.calledSubmit = true;
		this.entry.replySource = "llm";

		if (args.intent) {
			this.entry.llm!.intent = String(args.intent);
		}

		if (args.extractedPayload && typeof args.extractedPayload === "object") {
			this.entry.llm!.extractedFields = Object.keys(args.extractedPayload as object);
		}
	}

	/** Validation result from runtime */
	setValidation(acceptedCount: number, rejected: Array<{ field: string; reason: ValidationRejectReason }>): void {
		this.entry.validation = {
			acceptedCount,
			rejected: rejected.map((r) => ({ field: r.field, reason: r.reason })),
		};

		if (acceptedCount === 0 && rejected.length > 0) {
			this.entry.effectiveOutcome = "validation_blocked";
		}
	}

	/** PSF returned after submit_data */
	setPsfResult(turn: TurnResponse): void {
		this.entry.psfResult = { status: turn.status };
		if (turn.status === "active") {
			this.entry.psfResult.stepId = turn.step.id;
			this.entry.sessionId = turn.sessionId;
			if (turn.inputIssue) {
				this.entry.psfResult.inputIssue = turn.inputIssue.code;
				this.entry.effectiveOutcome = "input_issue";
			} else if (this.initialStepId && turn.step.id !== this.initialStepId) {
				this.entry.effectiveOutcome = "progressed";
			} else if (this.entry.psfStatus === "no_session") {
				this.entry.effectiveOutcome = "session_started";
			} else {
				this.entry.effectiveOutcome = "stayed_same_step";
			}
		} else if (turn.status === "terminal") {
			this.entry.effectiveOutcome = "completed";
		}
	}

	/** Runtime fallback was triggered */
	setFallback(packId: string | undefined, replyInjected: boolean): void {
		this.entry.fallback = {
			intentDetection: true,
			packId,
			replyInjected,
		};
		this.entry.replySource = replyInjected ? "fallback" : this.entry.replySource!;
		this.entry.effectiveOutcome = packId ? "fallback_used" : "no_session_pending";

		if (!packId) {
			this.entry.level = "warn";
		}
	}

	/** Guardrail action */
	setGuardrailAction(action: GuardrailAction): void {
		this.entry.guardrailAction = action.type;
		if (action.type === "force_escalation") {
			this.entry.replySource = "guardrail";
			this.entry.effectiveOutcome = "guardrail_escalated";
			this.entry.level = "warn";
		}
	}

	/** Final reply length + source override for runtime defaults */
	setReply(length: number, source?: ReplySource): void {
		this.entry.llm!.replyLength = length;
		if (source) {
			this.entry.replySource = source;
		}
	}

	/** Set error with code */
	setError(code: ErrorCode, err: unknown): void {
		this.entry.level = "error";
		this.entry.errorCode = code;
		this.entry.error = err instanceof Error ? err.message : String(err);
		if (this.entry.effectiveOutcome === "error" || !this.entry.effectiveOutcome) {
			this.entry.effectiveOutcome = "error";
		}
	}

	/** Flush the log entry to stdout as structured JSON */
	flush(): TurnLog {
		const log: TurnLog = {
			...this.entry,
			durationMs: Date.now() - this.startTime,
		} as TurnLog;

		// Structured JSON line — parseable by any log drain
		console.log(JSON.stringify(log));

		return log;
	}
}
