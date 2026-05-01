import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { ClinicBackendClient, RequestOptions } from "../core/backend-client.js";
import type { ControlBackendClient } from "../core/control-client.js";
import { approveAdminAction, blockedToolResult } from "../effects/admin-action-guard.js";

interface AdminToolsOptions {
	control?: ControlBackendClient;
	auditEventId?: string;
	agentId?: string;
}

/**
 * Session management tools for Telegram admin sessions.
 * These proxy actions to the psf-engine-v2 via /api/admin/*.
 *
 * Admin has two modes:
 *  - Global: no targetClientId (list sessions, overview)
 *  - Targeted: targetClientId specified (view, note, send message)
 */
export function createAdminTools(
	client: ClinicBackendClient,
	options: RequestOptions,
	toolOptions: AdminToolsOptions = {},
): AgentTool<any>[] {
	return [
		{
			name: "list_sessions",
			label: "List Client Sessions",
			description:
				"List all clinic client sessions. " +
				"Returns client names, current step, status, and time of last activity. " +
				"Translate statuses to Russian: active → «в процессе», terminal → «завершён».",
			parameters: Type.Object({
				status: Type.Optional(
					Type.String({ description: "Filter: 'active', 'terminal', or 'all'. Default: 'all'" }),
				),
				limit: Type.Optional(Type.Number({ description: "Max results. Default: 20" })),
			}),
			execute: async (_id, args: any) => {
				try {
					const result = await client.listSessions(
						{ status: args?.status || "all", limit: args?.limit || 20 },
						options,
					);
					return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
				} catch (err) {
					return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], details: null };
				}
			},
		},
		{
			name: "view_session",
			label: "View Session",
			description:
				"View detailed info about a specific client session: " +
				"collected data, current step, and recent patient conversation messages. Show only last 8 chars of any session ID.",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session ID to view (partial suffix is fine)" }),
			}),
			execute: async (_id, args: any) => {
				try {
					const result = await client.viewSession(args.sessionId, options);
					const patientHistory = await client.listClientMessages(args.sessionId, options, { limit: 30 });
					const details = {
						...(result && typeof result === "object" ? result : { session: result }),
						patientHistory,
					};
					return { content: [{ type: "text", text: JSON.stringify(details) }], details };
				} catch (err) {
					return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], details: null };
				}
			},
		},
		{
			name: "add_note",
			label: "Add Internal Note",
			description: "Add an internal operator note to a client session. Visible only to admins.",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session to annotate" }),
				note: Type.String({ description: "Note text" }),
			}),
			execute: async (_id, args: any) => {
				try {
					const result = await client.adminTool("add-note", args, options);
					return {
						content: [{ type: "text", text: result.ok ? "Note added." : "Failed to add note." }],
						details: result,
					};
				} catch (err) {
					return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], details: null };
				}
			},
		},
		{
			name: "override_field",
			label: "Override Field Value",
			description:
				"Override a specific field value in a client session. " +
				"REQUIRES a reason. This action is audit-logged. Always confirm before executing.",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session to modify" }),
				fieldKey: Type.String({ description: "Field key to override" }),
				newValue: Type.Unknown({ description: "New value for the field" }),
				reason: Type.String({ description: "REQUIRED: Why this override is needed" }),
			}),
			execute: async (_id, args: any) => {
				try {
					const approval = await approveAdminAction(toolOptions, options, {
						actionId: "override_field",
						sessionId: args.sessionId,
						reason: args.reason,
						payload: args,
					});
					if (!approval.allowed) {
						return blockedToolResult(approval.blockedReason);
					}
					const result = await client.adminTool("override-field", approval.payload, options);
					return {
						content: [
							{
								type: "text",
								text: result.ok ? `Field "${args.fieldKey}" overridden.` : "Override failed.",
							},
						],
						details: result,
					};
				} catch (err) {
					return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], details: null };
				}
			},
		},
		{
			name: "send_to_client",
			label: "Send Message to Client",
			description:
				"Send a message to a client via their channel (WhatsApp, etc.). " +
				"Use for follow-ups, clarifications, or status notifications.",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Session to identify the client" }),
				message: Type.String({ description: "Message to send" }),
			}),
			execute: async (_id, args: any) => {
				try {
					const approval = await approveAdminAction(toolOptions, options, {
						actionId: "send_to_client",
						sessionId: args.sessionId,
						reason: "admin_requested_client_message",
						payload: args,
						adminMessage: args.message,
					});
					if (!approval.allowed) {
						return blockedToolResult(approval.blockedReason);
					}
					const result = await client.adminTool("send-to-client", approval.payload, options);
					return {
						content: [
							{
								type: "text",
								text: result.ok ? "Message sent to client." : "Message logged (delivery unavailable).",
							},
						],
						details: result,
					};
				} catch (err) {
					return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], details: null };
				}
			},
		},
		{
			name: "confirm_booking",
			label: "Confirm Doctor Booking",
			description:
				"Confirm that an administrator reviewed the requested doctor appointment and approved it. " +
				"This assigns the doctor, marks the client profile as appointment_approved, and logs a client-visible approval message.",
			parameters: Type.Object({
				sessionId: Type.String({ description: "Client session/client ID to approve" }),
				doctorId: Type.String({ description: "Doctor identifier or display name" }),
				doctorName: Type.Optional(Type.String({ description: "Optional doctor display name" })),
				appointmentWindow: Type.Optional(
					Type.String({ description: "Approved appointment slot, e.g. 'вторник 16:30'" }),
				),
				note: Type.Optional(Type.String({ description: "Internal clinical/admin note" })),
				message: Type.Optional(Type.String({ description: "Client-facing approval message" })),
			}),
			execute: async (_id, args: any) => {
				try {
					const approval = await approveAdminAction(toolOptions, options, {
						actionId: "confirm_booking",
						sessionId: args.sessionId,
						reason: "admin_confirmed_booking",
						payload: args,
						adminMessage: args.message,
					});
					if (!approval.allowed) {
						return blockedToolResult(approval.blockedReason);
					}
					const result = await client.adminTool("confirm-booking", approval.payload, options);
					const nextStep = typeof result.nextStep === "string" ? result.nextStep : "appointment_approved";
					return {
						content: [
							{
								type: "text",
								text: result.ok
									? `Запись просмотрена администратором и утверждена врачом. Текущий статус записи: ${nextStep}.`
									: "Подтверждение записи не выполнено.",
							},
						],
						details: result,
					};
				} catch (err) {
					return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], details: null };
				}
			},
		},
		{
			name: "find_client",
			label: "Find Client by Name",
			description: "Search for a client by their full name. Returns matching client IDs and session details.",
			parameters: Type.Object({
				query: Type.String({ description: "Search query (full name or part of it)" }),
			}),
			execute: async (_id, args: any) => {
				try {
					const results = await client.listSessions({ query: args.query }, options);
					return { content: [{ type: "text", text: JSON.stringify(results) }], details: results };
				} catch (err) {
					return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], details: null };
				}
			},
		},
		{
			name: "send_enrichment_link",
			label: "Send Enrichment Link",
			description:
				"Generate a secure enrichment link and send it to the client. " +
				"You can provide EITHER clientId OR clientName. If clientName is provided, I will try to find the ID automatically.",
			parameters: Type.Object({
				clientId: Type.Optional(Type.String({ description: "Client identifier (e.g. WhatsApp ID)" })),
				clientName: Type.Optional(Type.String({ description: "Client's full name to search for" })),
				mode: Type.Optional(Type.String({ enum: ["intake", "profile_enrichment"], default: "intake" })),
				customMessage: Type.Optional(Type.String({ description: "Optional introduction text" })),
			}),
			execute: async (_id, args: any) => {
				try {
					let resolvedClientId = args.clientId;

					// 1. Resolve by name if needed
					if (!resolvedClientId && args.clientName) {
						const matches = await client.listSessions({ query: args.clientName }, options);
						if (matches.length === 0) {
							return {
								content: [{ type: "text", text: `Клиент с именем "${args.clientName}" не найден.` }],
								details: null,
							};
						}
						if (matches.length > 1) {
							return {
								content: [
									{
										type: "text",
										text: `Найдено несколько клиентов с именем "${args.clientName}". Пожалуйста, уточните ID из списка:\n${JSON.stringify(matches)}`,
									},
								],
								details: matches,
							};
						}
						resolvedClientId = matches[0].sessionId;
					}

					if (!resolvedClientId) {
						return {
							content: [{ type: "text", text: "Необходимо указать clientId или clientName." }],
							details: null,
						};
					}

					// 2. Approve and generate the link
					const linkApproval = await approveAdminAction(toolOptions, options, {
						actionId: "request_enrichment_link",
						sessionId: resolvedClientId,
						reason: "admin_requested_enrichment_link_generation",
						payload: {
							mode: args.mode || "intake",
						},
					});
					if (!linkApproval.allowed) {
						return blockedToolResult(linkApproval.blockedReason);
					}
					const { link } = await client.requestEnrichmentLink(resolvedClientId, options, {
						mode: args.mode || "intake",
					});

					// 3. Format message
					const intro =
						args.customMessage ||
						"Здравствуйте! Для продолжения нам нужно собрать немного данных в вашу анонимную клиническую анкету. Это займет не более 2-3 минут:";
					const fullMessage = `${intro}\n\n${link}`;

					// 4. Send to client
					const approval = await approveAdminAction(toolOptions, options, {
						actionId: "send_to_client",
						sessionId: resolvedClientId,
						reason: "admin_requested_enrichment_link",
						payload: {
							sessionId: resolvedClientId,
							message: fullMessage,
						},
						adminMessage: fullMessage,
					});
					if (!approval.allowed) {
						return blockedToolResult(approval.blockedReason);
					}
					const sendResult = await client.adminTool("send-to-client", approval.payload, options);

					return {
						content: [
							{
								type: "text",
								text: sendResult.ok
									? `Ссылка на анкету для "${args.clientName || resolvedClientId}" успешно отправлена.`
									: `Ссылка создана, но доставка не удалась: ${link}`,
							},
						],
						details: { link, sendResult },
					};
				} catch (err) {
					return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], details: null };
				}
			},
		},
	];
}
