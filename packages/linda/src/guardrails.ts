// ============================================================================
// Linda — Guard Rails
//
// Runtime safety net with composite stuck detection.
//
// Stuck = not just "many turns", but a combination of signals:
//   - same step, no PSF progress
//   - no new valid fields extracted
//   - repeated missed submit_data calls
//   - repeated validation rejections
//   - idle timeout
// ============================================================================

// ----------------------------------------------------------------------------
// Per-step tracker — tracks composite signals
// ----------------------------------------------------------------------------

interface StepTracker {
	stepId: string;
	/** Total turns on this step */
	turns: number;
	/** Turns where submit_data was NOT called */
	missedSubmits: number;
	/** Consecutive turns with no new valid fields */
	staleDataTurns: number;
	/** Consecutive turns with validation rejections */
	validationFailTurns: number;
	/** Set of field keys successfully submitted so far on this step */
	fieldsSubmitted: Set<string>;
	/** Last activity timestamp */
	lastActivity: number;
}

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

export interface GuardrailConfig {
	/** Absolute max turns per step (hard ceiling) (default: 10) */
	maxTurnsPerStep: number;
	/** Max consecutive missed submit_data calls (default: 3) */
	maxMissedSubmits: number;
	/** Max consecutive turns with no new fields (default: 4) */
	maxStaleTurns: number;
	/** Max consecutive validation-only failures (default: 3) */
	maxValidationFailTurns: number;
	/** Composite "stuck score" threshold (default: 5) */
	stuckScoreThreshold: number;
	/** Score threshold for warning (default: 3) */
	warnScoreThreshold: number;
	/** Step idle timeout in ms (default: 30min) */
	stepIdleTimeoutMs: number;
}

const DEFAULT_CONFIG: GuardrailConfig = {
	maxTurnsPerStep: 10,
	maxMissedSubmits: 3,
	maxStaleTurns: 4,
	maxValidationFailTurns: 3,
	stuckScoreThreshold: 5,
	warnScoreThreshold: 3,
	stepIdleTimeoutMs: 30 * 60 * 1000,
};

/** Relaxed config for admin — they know what they're doing */
const ADMIN_CONFIG: GuardrailConfig = {
	maxTurnsPerStep: 30,
	maxMissedSubmits: 10,
	maxStaleTurns: 15,
	maxValidationFailTurns: 10,
	stuckScoreThreshold: 20,
	warnScoreThreshold: 15,
	stepIdleTimeoutMs: 2 * 60 * 60 * 1000, // 2 hours
};

/**
 * Get guardrail config for a given role.
 * Admin gets relaxed limits; client gets strict.
 */
export function getGuardrailConfigForRole(role: "client" | "admin"): Partial<GuardrailConfig> {
	return role === "admin" ? ADMIN_CONFIG : DEFAULT_CONFIG;
}

// ----------------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------------

export type GuardrailAction =
	| { type: "ok" }
	| { type: "warn_stuck"; score: number; turns: number; stepId: string; signals: string[] }
	| { type: "force_escalation"; reason: string; stepId: string; score: number }
	| { type: "step_timeout"; stepId: string; idleMinutes: number };

// ----------------------------------------------------------------------------
// Turn result — what happened in this turn
// ----------------------------------------------------------------------------

export interface TurnSignals {
	/** Did LLM call submit_data? */
	calledSubmit: boolean;
	/** New field keys that were accepted (not rejected) this turn */
	newValidFields: string[];
	/** Were there any validation rejections? */
	hadValidationRejects: boolean;
}

// ----------------------------------------------------------------------------
// Main class
// ----------------------------------------------------------------------------

export class ConversationGuardrails {
	private readonly trackers = new Map<string, StepTracker>();
	private readonly config: GuardrailConfig;

	constructor(config?: Partial<GuardrailConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// --------------------------------------------------------------------------
	// Pre-check: before LLM runs
	// --------------------------------------------------------------------------

	checkBeforeTurn(chatKey: string, stepId: string | undefined): GuardrailAction {
		if (!stepId) return { type: "ok" };

		const tracker = this.trackers.get(chatKey);

		// New step or different step — reset tracker
		if (!tracker || tracker.stepId !== stepId) {
			this.trackers.set(chatKey, createTracker(stepId));
			return { type: "ok" };
		}

		// Check idle timeout
		const idleMs = Date.now() - tracker.lastActivity;
		if (idleMs > this.config.stepIdleTimeoutMs) {
			return {
				type: "step_timeout",
				stepId,
				idleMinutes: Math.round(idleMs / 60000),
			};
		}

		// Hard ceiling
		if (tracker.turns >= this.config.maxTurnsPerStep) {
			return {
				type: "force_escalation",
				reason: `Hard turn limit (${this.config.maxTurnsPerStep}) reached on step "${stepId}"`,
				stepId,
				score: 99,
			};
		}

		// Compute composite stuck score
		const { score, signals } = this.computeStuckScore(tracker);

		if (score >= this.config.stuckScoreThreshold) {
			return {
				type: "force_escalation",
				reason: `Stuck score ${score} on step "${stepId}": ${signals.join(", ")}`,
				stepId,
				score,
			};
		}

		if (score >= this.config.warnScoreThreshold) {
			return {
				type: "warn_stuck",
				score,
				turns: tracker.turns,
				stepId,
				signals,
			};
		}

		return { type: "ok" };
	}

	// --------------------------------------------------------------------------
	// Post-check: after LLM runs, record what happened
	// --------------------------------------------------------------------------

	recordTurnResult(chatKey: string, stepId: string | undefined, signals: TurnSignals): GuardrailAction {
		if (!stepId) return { type: "ok" };

		let tracker = this.trackers.get(chatKey);
		if (!tracker || tracker.stepId !== stepId) {
			tracker = createTracker(stepId);
			this.trackers.set(chatKey, tracker);
		}

		// Update counters
		tracker.turns++;
		tracker.lastActivity = Date.now();

		// Missed submit
		if (!signals.calledSubmit) {
			tracker.missedSubmits++;
		} else {
			tracker.missedSubmits = 0;
		}

		// Stale data (no new valid fields)
		if (signals.newValidFields.length === 0) {
			tracker.staleDataTurns++;
		} else {
			tracker.staleDataTurns = 0;
			for (const f of signals.newValidFields) {
				tracker.fieldsSubmitted.add(f);
			}
		}

		// Validation failures
		if (signals.hadValidationRejects && signals.newValidFields.length === 0) {
			tracker.validationFailTurns++;
		} else {
			tracker.validationFailTurns = 0;
		}

		// Re-check after recording
		const { score, signals: stuckSignals } = this.computeStuckScore(tracker);

		if (score >= this.config.stuckScoreThreshold) {
			return {
				type: "force_escalation",
				reason: `Stuck score ${score} after turn on "${stepId}": ${stuckSignals.join(", ")}`,
				stepId,
				score,
			};
		}

		return { type: "ok" };
	}

	// --------------------------------------------------------------------------
	// Composite stuck score
	// --------------------------------------------------------------------------

	private computeStuckScore(tracker: StepTracker): { score: number; signals: string[] } {
		let score = 0;
		const signals: string[] = [];

		// Consecutive missed submits: 1.5 points each
		if (tracker.missedSubmits >= 2) {
			const pts = Math.min(tracker.missedSubmits * 1.5, 4.5);
			score += pts;
			signals.push(`missed_submits=${tracker.missedSubmits}`);
		}

		// Stale data turns: 1 point each after 2
		if (tracker.staleDataTurns >= 2) {
			const pts = Math.min(tracker.staleDataTurns - 1, 3);
			score += pts;
			signals.push(`stale_data=${tracker.staleDataTurns}`);
		}

		// Validation fail streak: 1.5 points each
		if (tracker.validationFailTurns >= 2) {
			const pts = Math.min(tracker.validationFailTurns * 1.5, 4.5);
			score += pts;
			signals.push(`validation_fails=${tracker.validationFailTurns}`);
		}

		// High turn count adds background pressure: 0.5 per turn after 4
		if (tracker.turns > 4) {
			const pts = (tracker.turns - 4) * 0.5;
			score += pts;
			signals.push(`turns=${tracker.turns}`);
		}

		return { score: Math.round(score * 10) / 10, signals };
	}

	// --------------------------------------------------------------------------
	// Reset
	// --------------------------------------------------------------------------

	reset(chatKey: string): void {
		this.trackers.delete(chatKey);
	}
}

function createTracker(stepId: string): StepTracker {
	return {
		stepId,
		turns: 0,
		missedSubmits: 0,
		staleDataTurns: 0,
		validationFailTurns: 0,
		fieldsSubmitted: new Set(),
		lastActivity: Date.now(),
	};
}

// ----------------------------------------------------------------------------
// Build a context hint for the LLM when guardrails detect issues
// ----------------------------------------------------------------------------

export function guardrailHint(action: GuardrailAction): string | undefined {
	switch (action.type) {
		case "ok":
			return undefined;

		case "warn_stuck":
			return (
				`\n[SYSTEM_HINT: The conversation seems stuck (${action.signals.join(", ")}). ` +
				`Try rephrasing your question more simply, or ask if the user needs help with something else.]`
			);

		case "force_escalation":
			return (
				`\n[SYSTEM_HINT: ESCALATION NEEDED. ${action.reason}. ` +
				`Tell the user you're having trouble and suggest they contact support or try /reset.]`
			);

		case "step_timeout":
			return (
				`\n[SYSTEM_HINT: The user has been idle on this step for ${action.idleMinutes} minutes. ` +
				`Welcome them back warmly and remind them where they left off.]`
			);
	}
}
