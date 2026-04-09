import { describe, expect, it } from "vitest";
import { getGuardrailConfigForRole } from "./guardrails.js";
import { getSystemPrompt } from "./prompts/index.js";
import { getToolsForRole, type PsfToolsContext } from "./tools.js";
import { AGENT_POLICIES } from "./types.js";

// Minimal mock PSF client for tool creation
const mockPsf: any = {
	getTurn: async () => ({ status: "no_session", sessionId: null }),
	postTurn: async () => ({ status: "no_session", sessionId: null }),
	// Phase 2 admin methods
	listSessions: async () => [
		{
			sessionId: "s1",
			userId: "u1",
			channel: "whatsapp",
			status: "active",
			lastActivityAt: new Date().toISOString(),
		},
	],
	viewSession: async (id: string) => ({
		sessionId: id,
		userId: "u1",
		channel: "whatsapp",
		status: "active",
		lastActivityAt: new Date().toISOString(),
		collectedData: {},
		history: [],
	}),
	addNote: async () => ({ ok: true }),
	overrideField: async () => ({ ok: true }),
	sendToClient: async () => ({ ok: true }),
};

const defaultCtx: PsfToolsContext = { getCurrentStep: () => undefined };

// ============================================================================
// Prompt selection
// ============================================================================

describe("getSystemPrompt", () => {
	it("returns client prompt for client role", () => {
		const prompt = getSystemPrompt("client");
		expect(prompt).toContain("friendly assistant");
		expect(prompt).not.toContain("Admin");
	});

	it("returns admin prompt for admin role", () => {
		const prompt = getSystemPrompt("admin");
		expect(prompt).toContain("Admin");
		expect(prompt).toContain("operational assistant");
	});

	it("client and admin prompts are different", () => {
		expect(getSystemPrompt("client")).not.toBe(getSystemPrompt("admin"));
	});
});

// ============================================================================
// Tool registry
// ============================================================================

describe("getToolsForRole", () => {
	it("client gets only submit_data", () => {
		const tools = getToolsForRole("client", mockPsf, "user1", "whatsapp", defaultCtx);
		const names = tools.map((t) => t.name);
		expect(names).toEqual(["submit_data"]);
	});

	it("admin gets submit_data plus admin tools", () => {
		const tools = getToolsForRole("admin", mockPsf, "admin1", "telegram", defaultCtx);
		const names = tools.map((t) => t.name);
		expect(names).toContain("submit_data");
		expect(names).toContain("list_sessions");
		expect(names).toContain("view_session");
		expect(names).toContain("add_note");
		expect(names).toContain("override_field");
		expect(names).toContain("send_to_client");
		expect(names.length).toBeGreaterThan(1);
	});

	it("admin has more tools than client", () => {
		const clientTools = getToolsForRole("client", mockPsf, "u1", "whatsapp", defaultCtx);
		const adminTools = getToolsForRole("admin", mockPsf, "u2", "telegram", defaultCtx);
		expect(adminTools.length).toBeGreaterThan(clientTools.length);
	});

	it("admin list_sessions calls PSF and returns sessions", async () => {
		const tools = getToolsForRole("admin", mockPsf, "admin1", "telegram", defaultCtx);
		const listSessions = tools.find((t) => t.name === "list_sessions")!;
		const result = await listSessions.execute("call1", {}, undefined);
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		const parsed = JSON.parse(text);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed[0]).toHaveProperty("sessionId");
	});
});

// ============================================================================
// Guardrail config by role
// ============================================================================

describe("getGuardrailConfigForRole", () => {
	it("client gets strict config", () => {
		const config = getGuardrailConfigForRole("client");
		expect(config.maxTurnsPerStep).toBeLessThanOrEqual(10);
		expect(config.stuckScoreThreshold).toBeLessThanOrEqual(5);
	});

	it("admin gets relaxed config", () => {
		const config = getGuardrailConfigForRole("admin");
		expect(config.maxTurnsPerStep).toBeGreaterThanOrEqual(20);
		expect(config.stuckScoreThreshold).toBeGreaterThanOrEqual(15);
	});

	it("admin idle timeout is longer than client", () => {
		const clientConfig = getGuardrailConfigForRole("client");
		const adminConfig = getGuardrailConfigForRole("admin");
		expect(adminConfig.stepIdleTimeoutMs!).toBeGreaterThan(clientConfig.stepIdleTimeoutMs!);
	});
});

// ============================================================================
// Agent policies
// ============================================================================

describe("AGENT_POLICIES", () => {
	it("client policy restricts access", () => {
		const p = AGENT_POLICIES.client;
		expect(p.role).toBe("client");
		expect(p.canViewAllSessions).toBe(false);
		expect(p.canOverrideFields).toBe(false);
		expect(p.canSendClientMessages).toBe(false);
		expect(p.stuckDetectionEnabled).toBe(true);
		expect(p.sessionScope).toBe("own");
	});

	it("admin policy grants access", () => {
		const p = AGENT_POLICIES.admin;
		expect(p.role).toBe("admin");
		expect(p.canViewAllSessions).toBe(true);
		expect(p.canOverrideFields).toBe(true);
		expect(p.canSendClientMessages).toBe(true);
		expect(p.stuckDetectionEnabled).toBe(false);
		expect(p.sessionScope).toBe("all");
	});
});
