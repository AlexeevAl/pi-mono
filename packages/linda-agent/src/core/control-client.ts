import type {
	AgentTurnProposal,
	AuditEvent,
	ControlPostCheckResult,
	ControlTurnDecision,
	ControlTurnRequest,
} from "./control-types.js";
import type { BackendConfig } from "./types.js";

export class ControlBackendClient {
	constructor(private readonly config: BackendConfig) {}

	public async precheckTurn(request: ControlTurnRequest): Promise<ControlTurnDecision> {
		return await this.postJson<ControlTurnRequest, ControlTurnDecision>("/api/agent/control/precheck", request, {
			role: request.role,
			channel: request.channel,
		});
	}

	public async postcheckTurn(
		proposal: AgentTurnProposal,
		options: { role: string; channel: string } = { role: "client_agent", channel: "web" },
	): Promise<ControlPostCheckResult> {
		return await this.postJson<AgentTurnProposal, ControlPostCheckResult>(
			"/api/agent/control/postcheck",
			proposal,
			options,
		);
	}

	public async writeAuditEvent(event: AuditEvent): Promise<void> {
		await this.postJson<AuditEvent, unknown>("/api/agent/audit/events", event, {
			role: "client_agent",
			channel: event.channel,
		});
	}

	private async postJson<TRequest, TResponse>(
		path: string,
		body: TRequest,
		options: { role: string; channel: string },
	): Promise<TResponse> {
		const url = new URL(path, this.config.baseUrl);
		url.searchParams.append("firmId", this.config.firmId);

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: this.buildHeaders(options),
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const responseBody = await response.text();
			throw new Error(
				`[backend] control request '${path}' failed: ${response.status} ${response.statusText} — ${responseBody}`,
			);
		}

		if (response.status === 204) {
			return undefined as TResponse;
		}

		return (await response.json()) as TResponse;
	}

	private buildHeaders(options: { role: string; channel: string }): Record<string, string> {
		return {
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.config.sharedSecret}`,
			"X-PSF-Edge-Id": this.config.edgeId,
			"X-PSF-Agent-Role": options.role,
			"X-PSF-Channel": options.channel,
		};
	}
}
