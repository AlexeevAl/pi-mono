import type { BackendConfig, ClubAgentContext } from "./types.js";

export interface RequestOptions {
	role: string;
	channel: string;
}

/**
 * Shared HTTP client for all psf-engine-v2 API calls.
 * Used by both LindaClientAgent and LindaAdminAgent.
 */
export class ClinicBackendClient {
	constructor(private readonly config: BackendConfig) {}

	// --- Client context ---

	public async getAgentContext(clientId: string, options: RequestOptions): Promise<ClubAgentContext> {
		const url = new URL(`/api/agent/context/${encodeURIComponent(clientId)}`, this.config.baseUrl);
		url.searchParams.append("firmId", this.config.firmId);
		url.searchParams.append("channel", options.channel);
		url.searchParams.append("agentRole", options.role);

		const response = await fetch(url.toString(), {
			headers: this.buildHeaders(options),
		});

		if (!response.ok) {
			throw new Error(`[backend] context fetch failed: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as { context: ClubAgentContext };
		return data.context;
	}

	// --- Client tools ---

	public async executeTool(
		clientId: string,
		toolId: string,
		args: unknown,
		options: RequestOptions,
	): Promise<unknown> {
		const url = new URL(`/api/tools/${toolId}`, this.config.baseUrl);
		url.searchParams.append("firmId", this.config.firmId);

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: this.buildHeaders(options),
			body: JSON.stringify({ clientId, ...(args as object) }),
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(`[backend] tool '${toolId}' failed: ${response.status} — ${body}`);
		}

		return await response.json();
	}

	/**
	 * Directly fetch clinical profile data from /api/clients/:id/profile
	 */
	public async getClientProfile(clientId: string, options: RequestOptions): Promise<unknown> {
		const url = new URL(`/api/clients/${encodeURIComponent(clientId)}/profile`, this.config.baseUrl);
		url.searchParams.append("firmId", this.config.firmId);

		const response = await fetch(url.toString(), {
			headers: this.buildHeaders(options),
		});

		if (!response.ok) {
			throw new Error(`[backend] getProfile failed: ${response.status}`);
		}
		return await response.json();
	}

	/**
	 * Update clinical profile data at /api/clients/:id/profile
	 */
	public async patchClientProfile(clientId: string, patch: unknown, options: RequestOptions): Promise<unknown> {
		const url = new URL(`/api/clients/${encodeURIComponent(clientId)}/profile`, this.config.baseUrl);
		url.searchParams.append("firmId", this.config.firmId);

		const response = await fetch(url.toString(), {
			method: "PATCH",
			headers: this.buildHeaders(options),
			body: JSON.stringify(patch),
		});

		if (!response.ok) {
			throw new Error(`[backend] patchProfile failed: ${response.status}`);
		}
		return await response.json();
	}

	/**
	 * Request a new ephemeral enrichment link (intake) for a client.
	 * Returns { link: string, token: string }
	 */
	public async requestEnrichmentLink(
		clientId: string,
		options: RequestOptions,
		params: { mode?: string; questions?: any[] } = {},
	): Promise<{ link: string; token: string }> {
		const url = new URL(`/api/clients/${encodeURIComponent(clientId)}/enrichment-link`, this.config.baseUrl);
		url.searchParams.append("firmId", this.config.firmId);

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: this.buildHeaders(options),
			body: JSON.stringify(params),
		});

		if (!response.ok) {
			throw new Error(`[backend] requestEnrichmentLink failed: ${response.status}`);
		}
		return (await response.json()) as { link: string; token: string };
	}

	// --- Admin: list sessions ---

	public async listSessions(
		params: { status?: string; limit?: number; query?: string },
		options: RequestOptions,
	): Promise<any[]> {
		const url = new URL("/api/admin/sessions", this.config.baseUrl);
		url.searchParams.append("firmId", this.config.firmId);
		if (params.status) url.searchParams.append("status", params.status);
		if (params.limit) url.searchParams.append("limit", String(params.limit));
		if (params.query) url.searchParams.append("query", params.query);

		const response = await fetch(url.toString(), {
			headers: this.buildHeaders(options),
		});

		if (!response.ok) {
			throw new Error(`[backend] listSessions failed: ${response.status} ${response.statusText}`);
		}
		return (await response.json()) as any[];
	}

	// --- Admin: view session ---

	public async viewSession(sessionId: string, options: RequestOptions): Promise<unknown> {
		const url = new URL(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, this.config.baseUrl);
		url.searchParams.append("firmId", this.config.firmId);

		const response = await fetch(url.toString(), {
			headers: this.buildHeaders(options),
		});

		if (!response.ok) {
			throw new Error(`[backend] viewSession failed: ${response.status} ${response.statusText}`);
		}
		return await response.json();
	}

	// --- Admin: generic tool ---

	public async adminTool(
		toolId: string,
		args: unknown,
		options: RequestOptions,
	): Promise<{ ok: boolean; [key: string]: unknown }> {
		const url = new URL(`/api/admin/tools/${toolId}`, this.config.baseUrl);
		url.searchParams.append("firmId", this.config.firmId);

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: this.buildHeaders(options),
			body: JSON.stringify(args),
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(`[backend] adminTool '${toolId}' failed: ${response.status} — ${body}`);
		}
		return (await response.json()) as { ok: boolean };
	}

	// --- Shared ---

	private buildHeaders(options: RequestOptions): Record<string, string> {
		return {
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.config.sharedSecret}`,
			"X-PSF-Edge-Id": this.config.edgeId,
			"X-PSF-Agent-Role": options.role,
			"X-PSF-Channel": options.channel,
		};
	}
}
