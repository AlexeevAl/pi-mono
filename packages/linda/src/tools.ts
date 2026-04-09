// ============================================================================
// Linda — PSF Tool Registry
//
// Role-aware: client gets submit_data, admin gets session management tools.
// All tools call PSF — Linda never commits state itself.
// ============================================================================

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { resolvePackId } from "./intents.js";
import type { PsfClient } from "./psf.js";
import type { AgentRole, BridgeRegistry, LindaChannel, TurnStep } from "./types.js";
import { validateForStep, validatePayload } from "./validation.js";

export interface PsfToolsContext {
	/** Returns current step if session is active, undefined otherwise */
	getCurrentStep: () => TurnStep | undefined;
	/** Returns current message metadata for the active turn */
	getCurrentMessage?: () => { messageId: string; userText: string } | undefined;
	/** Optional bridge registry for sending direct messages to users */
	bridge?: BridgeRegistry;
}

// ============================================================================
// Role-aware tool registry
// ============================================================================

export function getToolsForRole(
	role: AgentRole,
	psf: PsfClient,
	userId: string,
	channel: LindaChannel,
	ctx: PsfToolsContext,
): AgentTool[] {
	switch (role) {
		case "client":
			return createClientTools(psf, userId, channel, ctx);
		case "admin":
			return [...createClientTools(psf, userId, channel, ctx), ...createAdminTools(psf, channel, ctx)];
	}
}

// ============================================================================
// Client tools — submit_data (intake flow)
// ============================================================================

function createClientTools(psf: PsfClient, userId: string, channel: LindaChannel, ctx: PsfToolsContext): AgentTool[] {
	const submitData: AgentTool = {
		name: "submit_data",
		label: "Submit extracted data to PSF",
		description:
			"Submit structured data extracted from the user's message to PSF. " +
			"CLIENTS ONLY: When status is 'no_session', provide the detected intent (e.g. 'mortgage', 'israel_exit', 'relocation'). " +
			"ADMINS ONLY: DO NOT use this to send messages or interact with other users! Use list_sessions and send_to_client instead. " +
			"When status is 'active', provide extracted field values in extractedPayload.",
		parameters: Type.Object({
			requestId: Type.String({
				description: "Unique ID for idempotency — optional, runtime fills from incoming message ID when omitted",
			}),
			userText: Type.String({
				description: "Original user message verbatim — optional, runtime fills it when omitted",
			}),
			extractedPayload: Type.Record(Type.String(), Type.Unknown(), {
				description:
					"MANDATORY: Structured data extracted from user text (e.g. {clientName: '...', clientPhone: '...'}).",
			}),
			intent: Type.Optional(
				Type.String({
					description:
						"Detected user intent — only when status is 'no_session'. " +
						"Use one of: 'israel_exit', 'mortgage', 'relocation', 'linda_relocation'",
				}),
			),
		}),
		prepareArguments: (args) => {
			const raw = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
			const currentMessage = ctx.getCurrentMessage?.();
			const currentStep = ctx.getCurrentStep();

			// Resolve extractedPayload — LLMs sometimes put fields at top level instead of nested
			let extractedPayload: Record<string, unknown> =
				raw.extractedPayload && typeof raw.extractedPayload === "object"
					? (raw.extractedPayload as Record<string, unknown>)
					: {};

			// Rescue: if payload is empty, check if any step field keys landed at top level
			if (Object.keys(extractedPayload).length === 0) {
				if (currentStep) {
					const reservedKeys = new Set(["requestId", "userText", "extractedPayload", "intent"]);
					const stepFieldKeys = new Set(currentStep.fields.map((f) => f.key));
					for (const [key, value] of Object.entries(raw)) {
						if (!reservedKeys.has(key) && stepFieldKeys.has(key) && value !== undefined && value !== null) {
							extractedPayload[key] = value;
						}
					}
					if (Object.keys(extractedPayload).length > 0) {
						console.log(
							`[Linda] 🔧 Rescued ${Object.keys(extractedPayload).length} field(s) from top-level params:`,
							Object.keys(extractedPayload).join(", "),
						);
					}
				}
			}

			// Normalize common aliases (name/phone/email) into step-specific keys.
			if (currentStep) {
				extractedPayload = normalizePayloadForStep(extractedPayload, currentStep);
				// Fallback: if the model failed to extract fields, derive missing step fields from raw user text.
				if (currentMessage?.userText) {
					extractedPayload = autoExtractForStep(extractedPayload, currentStep, currentMessage.userText);
				}
			}

			return {
				...raw,
				requestId:
					typeof raw.requestId === "string" && raw.requestId.trim().length > 0
						? raw.requestId
						: (currentMessage?.messageId ?? ""),
				userText:
					typeof raw.userText === "string" && raw.userText.trim().length > 0
						? raw.userText
						: (currentMessage?.userText ?? ""),
				extractedPayload,
			};
		},
		execute: async (_toolCallId, params: any, _signal) => {
			let packId: string | undefined;
			if (params.intent) {
				packId = resolvePackId(params.intent);
				if (!packId) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									error: "unknown_intent",
									message: `Unknown intent: "${params.intent}". Valid intents: israel_exit, mortgage, relocation, linda_relocation`,
								}),
							},
						],
						details: {},
					};
				}
			}

			const rawPayload = (params.extractedPayload as Record<string, unknown>) ?? {};
			const currentStep = ctx.getCurrentStep();
			const validation = currentStep ? validateForStep(rawPayload, currentStep) : validatePayload(rawPayload);

			if (validation.rejected.length > 0) {
				console.log(
					`[Linda] 🧹 Payload validation: rejected ${validation.rejected.length} field(s):`,
					validation.rejected.map((r) => `${r.field} (${r.reason})`).join(", "),
				);
			}

			const missingRequired =
				"missingRequired" in validation ? ((validation as any).missingRequired as string[]) : [];
			if (missingRequired.length > 0) {
				console.log(`[Linda] ⚠️  Step "${currentStep!.id}" still missing required: ${missingRequired.join(", ")}`);
			}

			const turn = await psf.postTurn({
				requestId: params.requestId,
				userId,
				channel,
				userText: params.userText,
				extractedPayload: validation.cleaned,
				packId,
			});
			return {
				content: [{ type: "text", text: JSON.stringify(turn, null, 2) }],
				details: { turn, validation },
			};
		},
	};

	return [submitData];
}

function normalizePayloadForStep(payload: Record<string, unknown>, step: TurnStep): Record<string, unknown> {
	const result: Record<string, unknown> = { ...payload };
	const stepFieldKeys = new Set(step.fields.map((f) => f.key));

	const aliasMap: Record<string, string[]> = {
		clientName: ["clientName", "name", "fullName", "full_name", "firstName", "first_name"],
		clientPhone: ["clientPhone", "phone", "phoneNumber", "phone_number", "mobile", "tel"],
		clientEmail: ["clientEmail", "email", "mail", "emailAddress", "email_address"],
		moveTimeline: ["moveTimeline", "timeline", "move_time", "whenMove", "departureTimeline", "departure"],
		targetCountry: ["targetCountry", "country", "destinationCountry", "destination", "moveCountry"],
		householdComposition: ["householdComposition", "composition", "whoMoves", "withWhom", "familyComposition"],
	};

	for (const [target, aliases] of Object.entries(aliasMap)) {
		if (!stepFieldKeys.has(target)) continue;
		if (hasNonEmptyString(result[target])) continue;
		for (const alias of aliases) {
			if (hasNonEmptyString(payload[alias])) {
				result[target] = String(payload[alias]).trim();
				break;
			}
		}
	}

	return result;
}

interface StepExtractionContext {
	text: string;
	normalizedText: string;
	email: string | undefined;
	phone: string | undefined;
	chunks: string[];
	usedChunkIndexes: Set<number>;
}

function autoExtractForStep(
	payload: Record<string, unknown>,
	step: TurnStep,
	userText: string,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...payload };
	const text = userText.trim();
	if (!text) return result;

	const context: StepExtractionContext = {
		text,
		normalizedText: normalizeForMatch(text),
		email: extractEmail(text),
		phone: extractPhone(text),
		chunks: extractTextChunks(text),
		usedChunkIndexes: new Set<number>(),
	};

	for (const [index, chunk] of context.chunks.entries()) {
		if (context.email && chunk.includes(context.email)) context.usedChunkIndexes.add(index);
		if (context.phone && chunk.includes(context.phone)) context.usedChunkIndexes.add(index);
	}

	for (const field of step.fields) {
		if (isFilled(result[field.key])) continue;
		const inferred = inferFieldValueFromText(field, step, context);
		if (inferred !== undefined) {
			result[field.key] = inferred;
		}
	}

	return result;
}

type StepFieldDef = TurnStep["fields"][number];

function inferFieldValueFromText(
	field: StepFieldDef,
	step: TurnStep,
	context: StepExtractionContext,
): string | undefined {
	const key = normalizeForMatch(field.key);

	if (isEmailLikeKey(key) && context.email) return context.email;
	if (isPhoneLikeKey(key) && context.phone) return context.phone;

	const suggestionMatch = matchSuggestion(field.suggestions, context.normalizedText, context.text);

	if (isTimelineLikeKey(key)) {
		const timeline = extractTimeline(context.text);
		if (timeline) return timeline;
		if (suggestionMatch) return suggestionMatch;
	}

	if (isCountryLikeKey(key)) {
		if (suggestionMatch) return suggestionMatch;
		const country = extractCountryFromText(context.text);
		if (country) return country;
	}

	if (isHouseholdLikeKey(key)) {
		if (suggestionMatch) return suggestionMatch;
		const household = extractHouseholdComposition(context.text);
		if (household) {
			const mapped = matchSuggestionByHint(field.suggestions, household);
			return mapped ?? household;
		}
	}

	if (isNameLikeKey(key)) {
		const name = extractName(context.text);
		if (name) return name;
	}

	if (suggestionMatch) return suggestionMatch;

	if (isAmountLikeKey(key)) {
		const amount = extractAmountPhrase(context.text);
		if (amount) return amount;
	}

	const fallbackChunk = takeChunkForField(field, step, context);
	if (fallbackChunk) return fallbackChunk;

	return undefined;
}

function takeChunkForField(field: StepFieldDef, _step: TurnStep, context: StepExtractionContext): string | undefined {
	if (context.chunks.length === 0) return undefined;
	if (isPhoneLikeKey(field.key) || isEmailLikeKey(field.key)) return undefined;

	for (const [index, chunk] of context.chunks.entries()) {
		if (context.usedChunkIndexes.has(index)) continue;
		if (!chunk) continue;
		if (chunk.length < 2) continue;
		context.usedChunkIndexes.add(index);
		return chunk;
	}

	return undefined;
}

function extractEmail(text: string): string | undefined {
	return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
}

function extractPhone(text: string): string | undefined {
	return text.match(/(?:\+?\d[\d\s()-]{5,}\d)/)?.[0]?.trim();
}

function extractTimeline(text: string): string | undefined {
	return text
		.match(
			/(через\s+\d+\s*(?:дн(?:я|ей)?|недел(?:ю|и|ь)?|месяц(?:а|ев)?|год(?:а|ов)?)|до\s*\d+\s*месяц(?:а|ев)?|в\s*ближайш(?:ее|ие)\s*время|ещ[её]\s*не\s*решил(?:и)?|in\s+\d+\s*(?:day|days|week|weeks|month|months|year|years)|within\s+\d+\s*(?:day|days|week|weeks|month|months|year|years))/i,
		)?.[0]
		?.trim();
}

function extractCountryFromText(text: string): string | undefined {
	const pattern =
		/(?:в|во|на|to|into)\s+(Германи(?:ю|я|и)|Португали(?:ю|я|и)|Кипр(?:е|а)?|США|Канад(?:у|а|е)|Израил(?:ь|я|е)|Испани(?:ю|я|и)|Франци(?:ю|я|и)|Итали(?:ю|я|и)|Великобритани(?:ю|я|и)|Англи(?:ю|я|и)|Germany|Portugal|Cyprus|USA|Canada|Israel|Spain|France|Italy|UK|England)/i;
	return text.match(pattern)?.[1]?.trim();
}

function extractName(text: string): string | undefined {
	const parts = extractTextChunks(text);
	return parts.find((part) => {
		if (part.includes("@")) return false;
		if (extractPhone(part)) return false;
		return /[A-Za-zА-Яа-яЁё\u0590-\u05FF]/.test(part) && part.split(/\s+/).length >= 2;
	});
}

function extractHouseholdComposition(text: string): string | undefined {
	const lower = text.toLowerCase();
	if (/вместе\s+с\s+жен|вместе\s+с\s+муж|с\s+партн[её]р|with\s+(my\s+)?(wife|husband|partner|spouse)/i.test(lower)) {
		return "С партнёром";
	}
	if (/с\s+детьми|реб[её]н|with\s+children/i.test(lower)) return "С детьми";
	if (/вся\s+семья|семь[её]й|whole\s+family/i.test(lower)) return "Вся семья";
	if (/с\s+родител|with\s+parents/i.test(lower)) return "С родителями";
	if (/один|одна|сам|сама|alone|by\s+myself/i.test(lower)) return "Один";
	return undefined;
}

function extractAmountPhrase(text: string): string | undefined {
	return text
		.match(/(?:до|около|примерно|from|about)?\s*\d[\d\s.,]*(?:₪|\$|€|шек|k|тыс|тысяч|million|млн)?/i)?.[0]
		?.trim();
}

function extractTextChunks(text: string): string[] {
	return text
		.split(/[,\n;]+/)
		.map((part) => part.trim())
		.filter(Boolean);
}

function matchSuggestion(
	suggestions: string[] | undefined,
	normalizedText: string,
	rawText: string,
): string | undefined {
	if (!suggestions || suggestions.length === 0) return undefined;

	let best: { suggestion: string; score: number } | undefined;
	for (const suggestion of suggestions) {
		const normalizedSuggestion = normalizeForMatch(suggestion);
		let score = 0;

		if (normalizedText.includes(normalizedSuggestion)) {
			score += 100;
		}

		const suggestionTokens = tokenize(normalizedSuggestion);
		const textTokens = tokenize(normalizedText);
		const overlap = suggestionTokens.filter((token) => tokenMatchInTokens(token, textTokens)).length;
		score += overlap * 10;

		score += suggestionHintBonus(normalizedSuggestion, rawText);
		score += timelineRangeBonus(normalizedSuggestion, rawText);

		if (!best || score > best.score) {
			best = { suggestion, score };
		}
	}

	return best && best.score > 0 ? best.suggestion : undefined;
}

function matchSuggestionByHint(suggestions: string[] | undefined, hint: string): string | undefined {
	if (!suggestions || suggestions.length === 0) return undefined;
	const normalizedHint = normalizeForMatch(hint);
	for (const suggestion of suggestions) {
		const normalizedSuggestion = normalizeForMatch(suggestion);
		if (normalizedSuggestion.includes(normalizedHint) || normalizedHint.includes(normalizedSuggestion)) {
			return suggestion;
		}
	}
	return undefined;
}

function suggestionHintBonus(normalizedSuggestion: string, rawText: string): number {
	const lower = rawText.toLowerCase();
	let bonus = 0;
	if (normalizedSuggestion.includes("партнер") || normalizedSuggestion.includes("partner")) {
		if (/(жен|муж|партн|spouse|wife|husband|partner)/i.test(lower)) bonus += 30;
	}
	if (normalizedSuggestion.includes("с детьми") || normalizedSuggestion.includes("children")) {
		if (/(дет|ребен|children|child)/i.test(lower)) bonus += 30;
	}
	if (normalizedSuggestion.includes("без детей") || normalizedSuggestion.includes("no children")) {
		if (/(детей нет|без детей|no children|without children)/i.test(lower)) bonus += 30;
	}
	if (normalizedSuggestion.includes("родител") || normalizedSuggestion.includes("parents")) {
		if (/(родител|parents)/i.test(lower)) bonus += 30;
	}
	if (normalizedSuggestion.includes("один") || normalizedSuggestion.includes("alone")) {
		if (/(один|одна|сам|сама|alone|by myself)/i.test(lower)) bonus += 30;
	}
	return bonus;
}

function timelineRangeBonus(normalizedSuggestion: string, rawText: string): number {
	const months = parseMonthsFromText(rawText);
	if (months === undefined) {
		if (normalizedSuggestion.includes("не решили") && /не\s*решил/i.test(rawText)) return 40;
		if (normalizedSuggestion.includes("undecided") && /undecided|not decided/i.test(rawText)) return 40;
		return 0;
	}

	const range = parseMonthRange(normalizedSuggestion);
	if (!range) return 0;
	return months >= range.min && months <= range.max ? 40 : 0;
}

function parseMonthsFromText(text: string): number | undefined {
	const match = text.match(/(?:через|in|within)\s*(\d+)\s*(?:месяц|месяца|месяцев|month|months)/i);
	if (!match?.[1]) return undefined;
	const parsed = Number.parseInt(match[1], 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function parseMonthRange(normalizedSuggestion: string): { min: number; max: number } | undefined {
	const upto = normalizedSuggestion.match(/до\s*(\d+)/);
	if (upto?.[1]) {
		const max = Number.parseInt(upto[1], 10);
		return { min: 0, max: Number.isFinite(max) ? max : 9999 };
	}

	const range = normalizedSuggestion.match(/(\d+)\s*[-–]\s*(\d+)/);
	if (range?.[1] && range[2]) {
		const min = Number.parseInt(range[1], 10);
		const max = Number.parseInt(range[2], 10);
		if (Number.isFinite(min) && Number.isFinite(max)) return { min, max };
	}

	const above = normalizedSuggestion.match(/более\s*(\d+)/);
	if (above?.[1]) {
		const min = Number.parseInt(above[1], 10);
		return { min: Number.isFinite(min) ? min + 1 : 0, max: 9999 };
	}

	return undefined;
}

function tokenize(value: string): string[] {
	return (value.match(/[a-zа-я0-9]+/gi) ?? []).map((token) => token.toLowerCase());
}

function tokenMatchInTokens(token: string, textTokens: string[]): boolean {
	if (token.length < 3) return textTokens.includes(token);
	return textTokens.some((textToken) => {
		if (textToken === token) return true;
		if (token.length >= 4 && textToken.length >= 4) {
			return textToken.startsWith(token.slice(0, 4)) || token.startsWith(textToken.slice(0, 4));
		}
		return false;
	});
}

function normalizeForMatch(value: string): string {
	return value
		.toLowerCase()
		.replaceAll("ё", "е")
		.replace(/[^\p{L}\p{N}\s-]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function isFilled(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return true;
}

function isEmailLikeKey(key: string): boolean {
	return /email|mail/.test(key);
}

function isPhoneLikeKey(key: string): boolean {
	return /phone|mobile|tel/.test(key);
}

function isNameLikeKey(key: string): boolean {
	return /name/.test(key);
}

function isCountryLikeKey(key: string): boolean {
	return /country|destination/.test(key);
}

function isTimelineLikeKey(key: string): boolean {
	return /timeline|time|date|when|departure/.test(key);
}

function isHouseholdLikeKey(key: string): boolean {
	return /household|composition|family|children|dependents/.test(key);
}

function isAmountLikeKey(key: string): boolean {
	return /amount|income|value|equity|budget|sum|price/.test(key);
}

function hasNonEmptyString(value: unknown): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

// ============================================================================
// Admin tools — session management (stubs with correct interfaces)
//
// These are the seams for Phase 2. Each tool has the right shape and params;
// execute() calls PSF admin endpoints (which you'll wire when PSF supports them).
// ============================================================================

function createAdminTools(psf: PsfClient, _channel: LindaChannel, ctx: PsfToolsContext): AgentTool[] {
	const listSessions: AgentTool = {
		name: "list_sessions",
		label: "List active client sessions",
		description:
			"List all active intake sessions. " +
			"Returns session IDs, client names, current step, and time since last activity.",
		parameters: Type.Object({
			status: Type.Optional(
				Type.String({
					description: "Filter by status: 'active', 'terminal', or 'all'. Default: 'all' (for admins)",
				}),
			),
			limit: Type.Optional(Type.Number({ description: "Max sessions to return. Default: 20" })),
		}),
		execute: async (_toolCallId, params: any, _signal) => {
			try {
				const sessions = await psf.listSessions({
					status: params.status || "all",
					limit: params.limit || 20,
				});
				return {
					content: [{ type: "text", text: JSON.stringify(sessions) }],
					details: { sessions },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Error listing sessions: ${(err as Error).message}` }],
					details: { error: err },
				};
			}
		},
	};

	const viewSession: AgentTool = {
		name: "view_session",
		label: "View a specific client session",
		description:
			"View detailed info about a specific client session: all steps, collected data, history, and current state.",
		parameters: Type.Object({
			sessionId: Type.String({ description: "The session ID to view" }),
		}),
		execute: async (_toolCallId, params: any, _signal) => {
			try {
				const detail = await psf.viewSession(params.sessionId);
				return {
					content: [{ type: "text", text: JSON.stringify(detail) }],
					details: { detail },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Error viewing session: ${(err as Error).message}` }],
					details: { error: err },
				};
			}
		},
	};

	const addNote: AgentTool = {
		name: "add_note",
		label: "Add a note to a session",
		description: "Add an internal note to a client session. Visible only to admins.",
		parameters: Type.Object({
			sessionId: Type.String({ description: "Session to annotate" }),
			note: Type.String({ description: "Note text" }),
		}),
		execute: async (_toolCallId, params: any, _signal) => {
			try {
				const res = await psf.addNote({
					sessionId: params.sessionId,
					note: params.note,
				});
				return {
					content: [{ type: "text", text: res.ok ? "Note added successfully." : "Failed to add note." }],
					details: { result: res },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Error adding note: ${(err as Error).message}` }],
					details: { error: err },
				};
			}
		},
	};

	const overrideField: AgentTool = {
		name: "override_field",
		label: "Override a field value in a session",
		description:
			"Override a specific field value in a client session. REQUIRES a reason. " +
			"This is a controlled write — will be audit-logged.",
		parameters: Type.Object({
			sessionId: Type.String({ description: "Session to modify" }),
			fieldKey: Type.String({ description: "Field key to override" }),
			newValue: Type.Unknown({ description: "New value for the field" }),
			reason: Type.String({ description: "REQUIRED: Why this override is needed" }),
		}),
		execute: async (_toolCallId, params: any, _signal) => {
			try {
				const res = await psf.overrideField({
					sessionId: params.sessionId,
					fieldKey: params.fieldKey,
					newValue: params.newValue,
					reason: params.reason,
				});
				return {
					content: [
						{
							type: "text",
							text: res.ok ? `Field "${params.fieldKey}" overridden successfully.` : "Override failed.",
						},
					],
					details: { result: res },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Error overriding field: ${(err as Error).message}` }],
					details: { error: err },
				};
			}
		},
	};

	const sendToClient: AgentTool = {
		name: "send_to_client",
		label: "Send a message to a client",
		description:
			"Send a message to a client through their WhatsApp/Channel. " +
			"Use this to follow up, ask for clarifications, or notify about status changes.",
		parameters: Type.Object({
			sessionId: Type.String({ description: "Session (to identify the client)" }),
			message: Type.String({ description: "Message text to send" }),
		}),
		execute: async (_toolCallId, params: any, _signal) => {
			try {
				const detail = await psf.viewSession(params.sessionId);
				const actorId =
					detail.channel === "whatsapp"
						? `user_wa_${detail.userId}`
						: detail.channel === "telegram"
							? `user_tg_${detail.userId}`
							: detail.channel === "discord"
								? `user_dc_${detail.userId}`
								: `user_tui_${detail.userId}`;

				let delivered = false;
				if (ctx.bridge) {
					delivered = await ctx.bridge.send(actorId, params.message);
				}

				const res = await psf.sendToClient({
					sessionId: params.sessionId,
					message: params.message,
				});

				const statusStr = delivered
					? "Message sent to client."
					: "Message logged to PSF (delivery not possible via current bridge).";
				return {
					content: [{ type: "text", text: res.ok ? statusStr : "Failed to record message in PSF." }],
					details: { result: res, delivered },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Error sending message: ${(err as Error).message}` }],
					details: { error: err },
				};
			}
		},
	};

	return [listSessions, viewSession, addNote, overrideField, sendToClient];
}

// ============================================================================
// Backward compat — old signature delegates to getToolsForRole("client")
// ============================================================================

/** @deprecated Use getToolsForRole() instead */
export function createPsfTools(
	psf: PsfClient,
	userId: string,
	channel: LindaChannel,
	ctx: PsfToolsContext,
): AgentTool[] {
	return getToolsForRole("client", psf, userId, channel, ctx);
}
