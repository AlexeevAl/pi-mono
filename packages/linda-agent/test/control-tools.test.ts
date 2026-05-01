import { describe, expect, it, vi } from "vitest";
import type { ClinicBackendClient, RequestOptions } from "../src/core/backend-client.js";
import type { ControlBackendClient } from "../src/core/control-client.js";
import { createAdminTools } from "../src/tools/admin-tools.js";
import { createClientTools } from "../src/tools/client-tools.js";

const clientOptions: RequestOptions = { role: "client_agent", channel: "web" };
const adminOptions: RequestOptions = { role: "admin_agent", channel: "web" };

describe("controlled tools", () => {
	it("blocks client profile mutation when the control guard is not configured", async () => {
		const patchClientProfile = vi.fn();
		const backend = { patchClientProfile } as unknown as ClinicBackendClient;
		const tools = createClientTools(backend, "client_123", clientOptions);
		const tool = findTool(tools, "patch_client_profile");

		const result = await tool.execute("tool_call_1", {
			identityPatch: { fullName: "Test User" },
		});

		expect(firstText(result.content)).toContain("control_guard_not_configured");
		expect(patchClientProfile).not.toHaveBeenCalled();
	});

	it("executes client profile mutation only with an approved action payload", async () => {
		const approvedPayload = { profilePatch: { activeStatus: "qualified" } };
		const patchClientProfile = vi.fn().mockResolvedValue({ ok: true });
		const postcheckTurn = vi.fn().mockResolvedValue({
			allowed: true,
			executableActions: [
				{
					actionId: "update_lead_fields",
					auditEventId: "audit_123",
					reason: "approved",
					payload: approvedPayload,
				},
			],
			sessionPatch: {},
			auditEventId: "audit_123",
		});
		const backend = { patchClientProfile } as unknown as ClinicBackendClient;
		const control = { postcheckTurn } as unknown as ControlBackendClient;
		const tools = createClientTools(backend, "client_123", clientOptions, {
			control,
			auditEventId: "audit_123",
			agentId: "firm_demo:client_agent",
			skillId: "manager",
		});
		const tool = findTool(tools, "patch_client_profile");

		const result = await tool.execute("tool_call_1", {
			identityPatch: { fullName: "Ignored Raw Payload" },
		});

		expect(firstText(result.content)).toBe("Profile updated successfully.");
		expect(postcheckTurn).toHaveBeenCalledTimes(1);
		expect(patchClientProfile).toHaveBeenCalledWith("client_123", approvedPayload, clientOptions);
	});

	it("blocks admin client messaging when the control guard is not configured", async () => {
		const adminTool = vi.fn();
		const backend = { adminTool } as unknown as ClinicBackendClient;
		const tools = createAdminTools(backend, adminOptions);
		const tool = findTool(tools, "send_to_client");

		const result = await tool.execute("tool_call_1", {
			sessionId: "client_123",
			message: "Здравствуйте",
		});

		expect(firstText(result.content)).toContain("control_guard_not_configured");
		expect(adminTool).not.toHaveBeenCalled();
	});
});

function findTool(tools: ReturnType<typeof createClientTools>, name: string) {
	const tool = tools.find((candidate) => candidate.name === name);
	if (!tool) {
		throw new Error(`tool_not_found:${name}`);
	}
	return tool;
}

function firstText(content: Array<{ type: string }>) {
	const item = content[0];
	if (!item || item.type !== "text" || !("text" in item) || typeof item.text !== "string") {
		throw new Error("expected_text_content");
	}
	return item.text;
}
