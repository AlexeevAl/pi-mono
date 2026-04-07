// ============================================================================
// Linda — PSF Tools for Agent
//
// Linda has exactly TWO tools. Both call PSF. Linda never commits state itself.
// PSF is the only source of truth.
// ============================================================================

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { PsfClient } from "./psf.js";
import type { LindaChannel } from "./types.js";

export function createPsfTools(psf: PsfClient, userId: string, channel: LindaChannel): AgentTool[] {
	const getCurrentStep: AgentTool = {
		name: "get_current_step",
		label: "Get current step from PSF",
		description:
			"Ask PSF what the user needs to do right now. " +
			"Call this at the start of every conversation turn to know the current step, " +
			"required fields, and what has already been collected.",
		parameters: Type.Object({}),
		execute: async (_toolCallId, _params, _signal) => {
			const turn = await psf.getTurn({ userId, channel });
			return {
				content: [{ type: "text", text: JSON.stringify(turn, null, 2) }],
				details: { turn },
			};
		},
	};

	const submitData: AgentTool = {
		name: "submit_data",
		label: "Submit extracted data to PSF",
		description:
			"Submit structured data extracted from the user's message to PSF for validation and commit. " +
			"If PSF returned 'no_session', call this tool IMMEDIATELY with the detected packId and an empty extractedPayload: {}. " +
			"PSF will then initialize the session and return the first step. " +
			"Only include actual field values when PSF status is 'active'.",
		parameters: Type.Object({
			requestId: Type.String({
				description: "Unique ID for idempotency — use the incoming message ID",
			}),
			userText: Type.String({
				description: "The original user message verbatim",
			}),
			extractedPayload: Type.Record(Type.String(), Type.Unknown(), {
				description: "Structured data extracted from user text. Only explicitly stated values.",
			}),
			packId: Type.Optional(
				Type.String({
					description: "Pack ID to start — only when PSF returned no_session",
				}),
			),
		}),
		execute: async (_toolCallId, params: any, _signal) => {
			const turn = await psf.postTurn({
				requestId: params.requestId,
				userId,
				channel,
				userText: params.userText,
				extractedPayload: params.extractedPayload as Record<string, unknown>,
				packId: params.packId,
			});
			return {
				content: [{ type: "text", text: JSON.stringify(turn, null, 2) }],
				details: { turn },
			};
		},
	};

	return [getCurrentStep, submitData];
}
