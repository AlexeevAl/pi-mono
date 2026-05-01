import { describe, expect, it, vi } from "vitest";
import type { RequestOptions } from "../src/core/backend-client.js";
import type { ControlBackendClient } from "../src/core/control-client.js";
import { approveAdminAction, blockedToolResult } from "../src/effects/admin-action-guard.js";

const options: RequestOptions = { role: "admin_agent", channel: "web" };

describe("admin action guard", () => {
	it("fails closed when guard context is missing", async () => {
		const approval = await approveAdminAction({}, options, {
			actionId: "send_to_client",
			sessionId: "client_123",
			reason: "test",
			payload: { sessionId: "client_123", message: "hello" },
		});

		expect(approval).toEqual({ allowed: false, blockedReason: "control_guard_not_configured" });
	});

	it("returns only the approved payload from postcheck", async () => {
		const approvedPayload = { sessionId: "client_123", message: "approved text" };
		const postcheckTurn = vi.fn().mockResolvedValue({
			allowed: true,
			executableActions: [
				{
					actionId: "send_to_client",
					auditEventId: "audit_123",
					reason: "approved",
					payload: approvedPayload,
				},
			],
			sessionPatch: {},
			auditEventId: "audit_123",
		});
		const control = { postcheckTurn } as unknown as ControlBackendClient;

		const approval = await approveAdminAction(
			{
				control,
				auditEventId: "audit_123",
				agentId: "firm_demo:admin_agent",
			},
			options,
			{
				actionId: "send_to_client",
				sessionId: "client_123",
				reason: "test",
				payload: { sessionId: "client_123", message: "raw text" },
				adminMessage: "raw text",
			},
		);

		expect(approval).toEqual({ allowed: true, payload: approvedPayload });
		expect(postcheckTurn).toHaveBeenCalledTimes(1);
	});

	it("formats blocked tool results consistently", () => {
		const result = blockedToolResult("policy_block");
		expect(result.details).toBeNull();
		expect(result.content).toEqual([
			{
				type: "text",
				text: "Action blocked by control guard: policy_block",
			},
		]);
	});
});
