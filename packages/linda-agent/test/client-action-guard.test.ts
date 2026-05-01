import { describe, expect, it, vi } from "vitest";
import type { RequestOptions } from "../src/core/backend-client.js";
import type { ControlBackendClient } from "../src/core/control-client.js";
import { approveClientAction, blockedToolResult } from "../src/effects/client-action-guard.js";

const options: RequestOptions = { role: "client_agent", channel: "web" };

describe("client action guard", () => {
	it("fails closed when guard context is missing", async () => {
		const approval = await approveClientAction({}, options, {
			actionId: "update_lead_fields",
			clientId: "client_123",
			reason: "test",
			payload: { profilePatch: { activeStatus: "qualified" } },
		});

		expect(approval).toEqual({ allowed: false, blockedReason: "control_guard_not_configured" });
	});

	it("returns only the approved payload from postcheck", async () => {
		const approvedPayload = { profilePatch: { activeStatus: "qualified" } };
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
		const control = { postcheckTurn } as unknown as ControlBackendClient;

		const approval = await approveClientAction(
			{
				control,
				auditEventId: "audit_123",
				agentId: "firm_demo:client_agent",
				skillId: "manager",
			},
			options,
			{
				actionId: "update_lead_fields",
				clientId: "client_123",
				reason: "test",
				payload: { profilePatch: { activeStatus: "raw" } },
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
