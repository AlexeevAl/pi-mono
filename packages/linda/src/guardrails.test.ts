import { describe, expect, it } from "vitest";
import { ConversationGuardrails, guardrailHint, type TurnSignals } from "./guardrails.js";

const OK_SIGNALS: TurnSignals = {
	calledSubmit: true,
	newValidFields: ["name"],
	hadValidationRejects: false,
};

const EMPTY_SIGNALS: TurnSignals = {
	calledSubmit: false,
	newValidFields: [],
	hadValidationRejects: false,
};

const VALIDATION_FAIL_SIGNALS: TurnSignals = {
	calledSubmit: true,
	newValidFields: [],
	hadValidationRejects: true,
};

describe("ConversationGuardrails", () => {
	// -- Basic behavior --

	it("returns ok for first turn on a step", () => {
		const g = new ConversationGuardrails();
		expect(g.checkBeforeTurn("chat1", "step1").type).toBe("ok");
	});

	it("returns ok when no stepId", () => {
		const g = new ConversationGuardrails();
		expect(g.checkBeforeTurn("chat1", undefined).type).toBe("ok");
		expect(g.recordTurnResult("chat1", undefined, OK_SIGNALS).type).toBe("ok");
	});

	it("resets tracker when step changes", () => {
		const g = new ConversationGuardrails();
		// Accumulate on step1
		for (let i = 0; i < 5; i++) {
			g.recordTurnResult("chat1", "step1", EMPTY_SIGNALS);
		}
		// Switch to step2 — should be fresh
		const action = g.checkBeforeTurn("chat1", "step2");
		expect(action.type).toBe("ok");
	});

	// -- Hard ceiling --

	it("escalates at hard turn limit", () => {
		const g = new ConversationGuardrails({ maxTurnsPerStep: 5 });
		g.checkBeforeTurn("chat1", "step1"); // init tracker
		for (let i = 0; i < 5; i++) {
			g.recordTurnResult("chat1", "step1", OK_SIGNALS);
		}
		const action = g.checkBeforeTurn("chat1", "step1");
		expect(action.type).toBe("force_escalation");
	});

	// -- Composite stuck: missed submits --

	it("escalates after consecutive missed submits", () => {
		const g = new ConversationGuardrails({
			stuckScoreThreshold: 4,
			maxTurnsPerStep: 20,
		});
		g.checkBeforeTurn("chat1", "step1"); // init

		// 3 missed submits = 3 * 1.5 = 4.5 → escalation
		let action: any;
		for (let i = 0; i < 3; i++) {
			action = g.recordTurnResult("chat1", "step1", EMPTY_SIGNALS);
		}
		expect(action!.type).toBe("force_escalation");
	});

	it("resets missed counter on successful submit", () => {
		const g = new ConversationGuardrails({ maxTurnsPerStep: 20 });
		g.checkBeforeTurn("chat1", "step1");

		// 2 misses
		g.recordTurnResult("chat1", "step1", EMPTY_SIGNALS);
		g.recordTurnResult("chat1", "step1", EMPTY_SIGNALS);

		// 1 success resets
		g.recordTurnResult("chat1", "step1", OK_SIGNALS);

		// 1 more miss — should still be ok (score low)
		const action = g.recordTurnResult("chat1", "step1", EMPTY_SIGNALS);
		expect(action.type).toBe("ok");
	});

	// -- Composite stuck: validation failures --

	it("escalates after consecutive validation-only failures", () => {
		const g = new ConversationGuardrails({
			stuckScoreThreshold: 4,
			maxTurnsPerStep: 20,
		});
		g.checkBeforeTurn("chat1", "step1");

		// 3 validation fails with no new fields = 3 * 1.5 = 4.5 (+ stale data too)
		let action: any;
		for (let i = 0; i < 3; i++) {
			action = g.recordTurnResult("chat1", "step1", VALIDATION_FAIL_SIGNALS);
		}
		expect(action!.type).toBe("force_escalation");
	});

	// -- Composite stuck: stale data --

	it("warns when data is stale for multiple turns", () => {
		const g = new ConversationGuardrails({
			warnScoreThreshold: 2,
			stuckScoreThreshold: 10,
			maxTurnsPerStep: 20,
		});
		g.checkBeforeTurn("chat1", "step1");

		// Submit called but no new fields
		const staleSubmit: TurnSignals = {
			calledSubmit: true,
			newValidFields: [],
			hadValidationRejects: false,
		};

		for (let i = 0; i < 4; i++) {
			g.recordTurnResult("chat1", "step1", staleSubmit);
		}

		// pre-check should show warning
		const action = g.checkBeforeTurn("chat1", "step1");
		expect(action.type === "warn_stuck" || action.type === "force_escalation").toBe(true);
	});

	// -- Progress resets counters --

	it("good signals keep score low", () => {
		const g = new ConversationGuardrails({ maxTurnsPerStep: 20 });
		g.checkBeforeTurn("chat1", "step1");

		// 6 good turns with new fields each time
		for (let i = 0; i < 6; i++) {
			g.recordTurnResult("chat1", "step1", {
				calledSubmit: true,
				newValidFields: [`field_${i}`],
				hadValidationRejects: false,
			});
		}

		const action = g.checkBeforeTurn("chat1", "step1");
		// turns > 4 gives some pressure but shouldn't escalate
		expect(action.type).not.toBe("force_escalation");
	});

	// -- Idle timeout --

	it("detects idle timeout", () => {
		const g = new ConversationGuardrails({ stepIdleTimeoutMs: 100 });
		g.checkBeforeTurn("chat1", "step1");
		g.recordTurnResult("chat1", "step1", OK_SIGNALS);

		// Manually set last activity to past
		// We can test by creating a new turn after timeout
		// For unit test, we'll just verify the timeout path works
		// by using a very short timeout
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				const action = g.checkBeforeTurn("chat1", "step1");
				expect(action.type).toBe("step_timeout");
				resolve();
			}, 150);
		});
	});

	// -- Reset --

	it("reset clears tracker", () => {
		const g = new ConversationGuardrails();
		g.checkBeforeTurn("chat1", "step1");
		for (let i = 0; i < 5; i++) {
			g.recordTurnResult("chat1", "step1", EMPTY_SIGNALS);
		}
		g.reset("chat1");
		expect(g.checkBeforeTurn("chat1", "step1").type).toBe("ok");
	});
});

// ============================================================================
// Hint generation
// ============================================================================

describe("guardrailHint", () => {
	it("returns undefined for ok", () => {
		expect(guardrailHint({ type: "ok" })).toBeUndefined();
	});

	it("returns hint for warn_stuck", () => {
		const hint = guardrailHint({ type: "warn_stuck", score: 3, turns: 5, stepId: "s1", signals: ["turns=5"] });
		expect(hint).toContain("SYSTEM_HINT");
		expect(hint).toContain("stuck");
	});

	it("returns hint for force_escalation", () => {
		const hint = guardrailHint({ type: "force_escalation", reason: "test", stepId: "s1", score: 6 });
		expect(hint).toContain("ESCALATION");
	});

	it("returns hint for step_timeout", () => {
		const hint = guardrailHint({ type: "step_timeout", stepId: "s1", idleMinutes: 45 });
		expect(hint).toContain("45 minutes");
	});
});
