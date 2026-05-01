import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { RequestOptions } from "../core/backend-client.js";
import type { ControlBackendClient } from "../core/control-client.js";

export interface ClientActionGuardOptions {
	control?: ControlBackendClient;
	auditEventId?: string;
	agentId?: string;
	skillId?: string;
}

export interface ClientActionApprovalRequest {
	actionId: string;
	clientId: string;
	reason: string;
	payload: Record<string, unknown>;
}

export type ClientActionApproval =
	| { allowed: true; payload: Record<string, unknown> }
	| { allowed: false; blockedReason?: string };

export async function approveClientAction(
	guard: ClientActionGuardOptions,
	options: RequestOptions,
	action: ClientActionApprovalRequest,
): Promise<ClientActionApproval> {
	if (!guard.control || !guard.auditEventId || !guard.agentId) {
		return { allowed: false, blockedReason: "control_guard_not_configured" };
	}
	const result = await guard.control.postcheckTurn(
		{
			auditEventId: guard.auditEventId,
			sessionId: action.clientId,
			agentId: guard.agentId,
			skillId: guard.skillId ?? "manager",
			proposedActions: [
				{
					actionId: action.actionId,
					reason: action.reason,
					payload: action.payload,
				},
			],
			extractedFields: {},
			confidence: 0.9,
		},
		options,
	);
	const approved = result.executableActions.find((item) => item.actionId === action.actionId);
	if (!result.allowed || !approved) {
		return { allowed: false, blockedReason: result.blockedReason ?? "action_not_approved" };
	}
	return { allowed: true, payload: approved.payload };
}

export function blockedToolResult(blockedReason?: string): AgentToolResult<null> {
	return {
		content: [
			{
				type: "text",
				text: blockedReason
					? `Action blocked by control guard: ${blockedReason}`
					: "Action blocked by control guard.",
			},
		],
		details: null,
	};
}
