import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { RequestOptions } from "../core/backend-client.js";
import type { ControlBackendClient } from "../core/control-client.js";

export interface AdminActionGuardOptions {
	control?: ControlBackendClient;
	auditEventId?: string;
	agentId?: string;
}

export interface AdminActionApprovalRequest {
	actionId: string;
	sessionId?: string;
	reason: string;
	payload: Record<string, unknown>;
	adminMessage?: string;
}

export type AdminActionApproval =
	| { allowed: true; payload: Record<string, unknown> }
	| { allowed: false; blockedReason?: string };

export async function approveAdminAction(
	guard: AdminActionGuardOptions,
	options: RequestOptions,
	action: AdminActionApprovalRequest,
): Promise<AdminActionApproval> {
	if (!guard.control || !guard.auditEventId || !guard.agentId) {
		return { allowed: false, blockedReason: "control_guard_not_configured" };
	}
	const sessionId = action.sessionId?.trim();
	if (!sessionId) {
		return { allowed: false, blockedReason: "missing_session_id" };
	}
	const result = await guard.control.postcheckTurn(
		{
			auditEventId: guard.auditEventId,
			sessionId,
			agentId: guard.agentId,
			skillId: "admin_assistant",
			adminMessage: action.adminMessage,
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
