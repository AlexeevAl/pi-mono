import { describe, expect, it, vi } from "vitest";
import type { ClinicBackendClient, RequestOptions } from "../src/core/backend-client.js";
import {
	canExecuteApprovedClientActions,
	executeApprovedClientActions,
} from "../src/effects/client-action-executor.js";

const options: RequestOptions = { role: "client_agent", channel: "web" };

describe("client action executor", () => {
	it("requires every proposed action to be approved and locally supported", () => {
		expect(
			canExecuteApprovedClientActions({
				proposedActions: [{ actionId: "update_lead_fields", reason: "test", payload: {} }],
				executableActions: [
					{
						actionId: "update_lead_fields",
						auditEventId: "audit_123",
						reason: "approved",
						payload: {},
					},
				],
			}),
		).toBe(true);

		expect(
			canExecuteApprovedClientActions({
				proposedActions: [{ actionId: "send_to_client", reason: "test", payload: {} }],
				executableActions: [
					{
						actionId: "send_to_client",
						auditEventId: "audit_123",
						reason: "approved",
						payload: {},
					},
				],
			}),
		).toBe(false);
	});

	it("executes update_lead_fields through the backend profile patch effect", async () => {
		const payload = { profilePatch: { activeStatus: "qualified" } };
		const patchClientProfile = vi.fn().mockResolvedValue({ ok: true });
		const backend = { patchClientProfile } as unknown as ClinicBackendClient;

		await executeApprovedClientActions({
			backend,
			clientId: "client_123",
			actions: [
				{
					actionId: "update_lead_fields",
					auditEventId: "audit_123",
					reason: "approved",
					payload,
				},
			],
			options,
		});

		expect(patchClientProfile).toHaveBeenCalledWith("client_123", payload, options);
	});
});
