// ============================================================================
// Linda — PSF Client
// Linda has NO authority. PSF is the only source of truth.
// ============================================================================

import { createHmac } from "node:crypto";
import type { GetTurnRequest, PostTurnRequest, ResetSessionRequest, TurnResponse } from "./types.js";

export interface PsfClientConfig {
	baseUrl: string;
	sharedSecret: string;
	timeoutMs?: number;
}

function signRequest(body: string, timestamp: string, secret: string): string {
	return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

async function psfFetch<T>(
	config: PsfClientConfig,
	path: string,
	method: "GET" | "POST" | "DELETE",
	body?: unknown,
): Promise<T> {
	const bodyStr = body !== undefined ? JSON.stringify(body) : "";
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = signRequest(bodyStr, timestamp, config.sharedSecret);

	const response = await fetch(`${config.baseUrl}${path}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			"X-Bridge-Timestamp": timestamp,
			"X-Bridge-Signature": signature,
		},
		body: bodyStr || undefined,
		signal: AbortSignal.timeout(config.timeoutMs ?? 30000),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`PSF ${method} ${path} → ${response.status}: ${text.slice(0, 200)}`);
	}

	return response.json() as Promise<T>;
}

export class PsfClient {
	constructor(private readonly config: PsfClientConfig) {}

	/** Ask PSF: what does the user need to do right now? */
	async getTurn(req: GetTurnRequest): Promise<TurnResponse> {
		const params = new URLSearchParams({
			userId: req.userId,
			channel: req.channel,
		});
		return psfFetch<TurnResponse>(this.config, `/api/linda/turn?${params}`, "GET");
	}

	/** Submit extracted user data to PSF. PSF validates and commits. */
	async postTurn(req: PostTurnRequest): Promise<TurnResponse> {
		return psfFetch<TurnResponse>(this.config, "/api/linda/turn", "POST", req);
	}

	/** Reset the session for a user. PSF handles cleanup. */
	async resetSession(req: ResetSessionRequest): Promise<{ ok: boolean }> {
		return psfFetch<{ ok: boolean }>(this.config, "/api/linda/session/reset", "POST", req);
	}
}
