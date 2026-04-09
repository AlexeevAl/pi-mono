import { describe, expect, it, vi } from "vitest";
import { TurnLogger } from "./logger.js";
import type { TurnResponse } from "./types.js";

const mockMsg = {
	messageId: "msg_001",
	userId: "user_12345678",
	chatId: "chat_87654321",
	channel: "telegram" as const,
	role: "client" as const,
};

describe("TurnLogger", () => {
	it("produces a valid TurnLog on flush", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const log = new TurnLogger(mockMsg);

		const activeTurn: TurnResponse = {
			status: "active",
			sessionId: "sess_001",
			step: {
				id: "collect_contact",
				kind: "collect",
				fields: [{ key: "name", label: "Name", required: true }],
				alreadyCollected: {},
			},
		};

		log.setPsfState(activeTurn);
		log.setSubmitCalled({ intent: undefined, extractedPayload: { name: "Иван", phone: "+79991234567" } });
		log.setPsfResult({
			status: "active",
			sessionId: "sess_001",
			step: {
				id: "collect_address",
				kind: "collect",
				fields: [],
				alreadyCollected: { name: "Иван" },
			},
		});
		log.setValidation(2, []);
		log.setReply(100, "llm");

		const result = log.flush();

		expect(result.event).toBe("turn");
		expect(result.turnId).toBe("msg_001");
		expect(result.sessionId).toBe("sess_001");
		expect(result.psfStatus).toBe("active");
		expect(result.stepId).toBe("collect_contact");
		expect(result.replySource).toBe("llm");
		expect(result.effectiveOutcome).toBe("progressed");
		expect(result.llm.calledSubmit).toBe(true);
		expect(result.llm.extractedFields).toEqual(["name", "phone"]);
		expect(result.llm.replyLength).toBe(100);
		expect(result.validation?.acceptedCount).toBe(2);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.level).toBe("info");

		// Verify JSON was output
		expect(spy).toHaveBeenCalledOnce();
		const outputJson = JSON.parse(spy.mock.calls[0][0]);
		expect(outputJson.event).toBe("turn");

		spy.mockRestore();
	});

	it("sets effectiveOutcome to session_started when going from no_session", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const log = new TurnLogger(mockMsg);
		log.setPsfState({ status: "no_session", sessionId: null });
		log.setSubmitCalled({ intent: "mortgage" });
		log.setPsfResult({
			status: "active",
			sessionId: "sess_002",
			step: { id: "step1", kind: "collect", fields: [], alreadyCollected: {} },
		});
		log.setReply(50, "llm");

		const result = log.flush();
		expect(result.effectiveOutcome).toBe("session_started");

		spy.mockRestore();
	});

	it("sets effectiveOutcome to completed on terminal", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const log = new TurnLogger(mockMsg);
		log.setPsfState({
			status: "active",
			sessionId: "sess_001",
			step: { id: "step1", kind: "collect", fields: [], alreadyCollected: {} },
		});
		log.setPsfResult({
			status: "terminal",
			sessionId: "sess_001",
			outcome: { handoffTriggered: false },
		});
		log.setReply(50, "llm");

		const result = log.flush();
		expect(result.effectiveOutcome).toBe("completed");

		spy.mockRestore();
	});

	it("tracks fallback with replySource", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const log = new TurnLogger(mockMsg);
		log.setPsfState({ status: "no_session", sessionId: null });
		log.setFallback("mortgage_v1", true);
		log.setReply(80);

		const result = log.flush();
		expect(result.replySource).toBe("fallback");
		expect(result.effectiveOutcome).toBe("fallback_used");
		expect(result.fallback?.packId).toBe("mortgage_v1");

		spy.mockRestore();
	});

	it("tracks guardrail escalation", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const log = new TurnLogger(mockMsg);
		log.setPsfState({
			status: "active",
			sessionId: "sess_001",
			step: { id: "step1", kind: "collect", fields: [], alreadyCollected: {} },
		});
		log.setGuardrailAction({ type: "force_escalation", reason: "stuck", stepId: "step1", score: 6 });
		log.setReply(120, "guardrail");

		const result = log.flush();
		expect(result.replySource).toBe("guardrail");
		expect(result.effectiveOutcome).toBe("guardrail_escalated");
		expect(result.guardrailAction).toBe("force_escalation");
		expect(result.level).toBe("warn");

		spy.mockRestore();
	});

	it("tracks PSF errors with error codes", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const log = new TurnLogger(mockMsg);
		log.setPsfError(new Error("Connection refused"));

		const result = log.flush();
		expect(result.level).toBe("error");
		expect(result.errorCode).toBe("psf_unreachable");
		expect(result.error).toBe("Connection refused");
		expect(result.effectiveOutcome).toBe("error");

		spy.mockRestore();
	});

	it("redacts userId and chatId", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const log = new TurnLogger(mockMsg);
		log.setPsfState({ status: "no_session", sessionId: null });
		log.setReply(0);

		const result = log.flush();
		// userId "user_12345678" should be partially masked
		expect(result.userId).toContain("***");
		expect(result.userId).not.toBe("user_12345678");

		spy.mockRestore();
	});
});
