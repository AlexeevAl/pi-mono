import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { ClinicBackendClient, RequestOptions } from "../core/backend-client.js";
import type { ControlBackendClient } from "../core/control-client.js";

interface ClientToolsOptions {
	allowEnrichmentLink?: boolean;
	control?: ControlBackendClient;
	auditEventId?: string;
	agentId?: string;
	skillId?: string;
}

/**
 * Clinical tools for WhatsApp client sessions.
 * These interaction tools connect the agent's logic to the real psf-engine-v2 backend.
 */
export function createClientTools(
	client: ClinicBackendClient,
	clientId: string,
	options: RequestOptions,
	toolOptions: ClientToolsOptions = {},
): AgentTool<any>[] {
	const tools: AgentTool<any>[] = [
		{
			name: "get_client_profile",
			label: "Get Client Profile",
			description: "Fetch the patient's identity and clinical profile bundle (age, city, symptoms, history).",
			parameters: Type.Object({}),
			execute: async () => {
				try {
					const result = await client.getClientProfile(clientId, options);
					return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
				} catch (err) {
					return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], details: null };
				}
			},
		},
		{
			name: "patch_client_profile",
			label: "Update Client Profile",
			description: "Update the patient's identity (fullName, email) or clinical profile fields (symptoms, etc.)",
			parameters: Type.Object({
				identityPatch: Type.Optional(
					Type.Object({
						fullName: Type.Optional(Type.String()),
						email: Type.Optional(Type.String()),
						phone: Type.Optional(Type.String()),
						birthDate: Type.Optional(Type.String()),
						city: Type.Optional(Type.String()),
					}),
				),
				profilePatch: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
				sourceType: Type.Optional(Type.String({ default: "intake_answer" })),
			}),
			execute: async (_id, args: any) => {
				try {
					const approval = await approveClientAction(toolOptions, options, {
						actionId: "update_lead_fields",
						clientId,
						reason: "client_profile_patch_tool",
						payload: args,
					});
					if (!approval.allowed) {
						return blockedToolResult(approval.blockedReason);
					}
					const result = await client.patchClientProfile(clientId, approval.payload, options);
					return { content: [{ type: "text", text: "Profile updated successfully." }], details: result };
				} catch (err) {
					return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], details: null };
				}
			},
		},
		{
			name: "log_interest_signal",
			label: "Log Interest Signal",
			description: "Record a patient's interest in a specific service or topic.",
			parameters: Type.Object({
				signalType: Type.String({ description: "Type of interest (e.g., 'iv_therapy', 'diagnostics')" }),
				signalValue: Type.Optional(Type.String({ description: "Additional context" })),
			}),
			execute: async (_id, args: any) => {
				try {
					const approval = await approveClientAction(toolOptions, options, {
						actionId: "log_interest_signal",
						clientId,
						reason: "client_interest_signal_tool",
						payload: args,
					});
					if (!approval.allowed) {
						return blockedToolResult(approval.blockedReason);
					}
					// This one still goes through generic tools path as it's a specific action
					const result = await client.executeTool(clientId, "log-interest-signal", approval.payload, options);
					return { content: [{ type: "text", text: "Interest signal logged." }], details: result };
				} catch (err) {
					return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], details: null };
				}
			},
		},
		{
			name: "escalate_to_human",
			label: "Escalate to Human",
			description: "Notify a human operator if the agent cannot resolve the patient's request.",
			parameters: Type.Object({
				reason: Type.String({ description: "Why escalation is needed" }),
			}),
			execute: async (_id, args: any) => {
				try {
					const approval = await approveClientAction(toolOptions, options, {
						actionId: "escalate_to_human",
						clientId,
						reason: "client_escalation_tool",
						payload: args,
					});
					if (!approval.allowed) {
						return blockedToolResult(approval.blockedReason);
					}
					const result = await client.executeTool(clientId, "escalate-to-human", approval.payload, options);
					return { content: [{ type: "text", text: "Escalation initiated." }], details: result };
				} catch (err) {
					return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], details: null };
				}
			},
		},
	];

	if (toolOptions.allowEnrichmentLink) {
		tools.push({
			name: "request_enrichment_link",
			label: "Request Enrichment Link",
			description:
				"Generate a secure, ephemeral link for the patient to fill out their clinical profile (intake form). Useful when the profile is incomplete.",
			parameters: Type.Object({
				mode: Type.Optional(
					Type.String({
						description: "Type of enrichment session",
						enum: ["intake", "profile_enrichment"],
					}),
				),
				questions: Type.Optional(
					Type.Array(
						Type.Union([
							Type.String({ description: "Field name from completeness check" }),
							Type.Object({
								id: Type.String(),
								text: Type.String(),
								type: Type.String({ enum: ["choice", "text", "rating"] }),
								options: Type.Optional(
									Type.Array(
										Type.Object({
											label: Type.String(),
											value: Type.String(),
										}),
									),
								),
							}),
						]),
						{ description: "Optional specific questions to ask instead of defaults" },
					),
				),
			}),
			execute: async (_id, args: any) => {
				try {
					const approval = await approveClientAction(toolOptions, options, {
						actionId: "request_enrichment_link",
						clientId,
						reason: "client_enrichment_link_tool",
						payload: args,
					});
					if (!approval.allowed) {
						return blockedToolResult(approval.blockedReason);
					}
					const result = await client.requestEnrichmentLink(clientId, options, approval.payload);
					return {
						content: [{ type: "text", text: `Enrichment link generated: ${result.link}` }],
						details: result,
					};
				} catch (err) {
					return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], details: null };
				}
			},
		});
	}

	return tools;
}

async function approveClientAction(
	toolOptions: ClientToolsOptions,
	options: RequestOptions,
	action: {
		actionId: string;
		clientId: string;
		reason: string;
		payload: Record<string, unknown>;
	},
): Promise<{ allowed: true; payload: Record<string, unknown> } | { allowed: false; blockedReason?: string }> {
	if (!toolOptions.control || !toolOptions.auditEventId || !toolOptions.agentId) {
		return { allowed: false, blockedReason: "control_guard_not_configured" };
	}
	const result = await toolOptions.control.postcheckTurn(
		{
			auditEventId: toolOptions.auditEventId,
			sessionId: action.clientId,
			agentId: toolOptions.agentId,
			skillId: toolOptions.skillId ?? "manager",
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

function blockedToolResult(blockedReason?: string) {
	return {
		content: [
			{
				type: "text" as const,
				text: blockedReason
					? `Action blocked by control guard: ${blockedReason}`
					: "Action blocked by control guard.",
			},
		],
		details: null,
	};
}
