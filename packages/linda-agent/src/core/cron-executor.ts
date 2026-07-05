import type { LindaAdminAgent } from "../agents/LindaAdminAgent.js";
import type { LindaClientAgent } from "../agents/LindaClientAgent.js";
import { ClinicBackendClient, type LindaCronJob } from "./backend-client.js";
import type { BackendConfig } from "./types.js";

export class LindaCronExecutor {
	private readonly backend: ClinicBackendClient;
	private timer?: NodeJS.Timeout;
	private polling = false;

	constructor(
		backend: BackendConfig,
		private readonly agents: { clientAgent: LindaClientAgent; adminAgent: LindaAdminAgent },
		private readonly pollIntervalMs = 10_000,
	) {
		this.backend = new ClinicBackendClient(backend);
	}

	public async start(): Promise<void> {
		console.log(`[Cron] polling every ${this.pollIntervalMs}ms`);
		this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
		await this.poll();
	}

	public stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}

	private async poll(): Promise<void> {
		if (this.polling) return;
		this.polling = true;
		try {
			const jobs = await this.backend.claimCronJobs();
			for (const job of jobs) await this.execute(job);
		} catch (error) {
			console.error("[Cron] poll failed:", error instanceof Error ? error.message : String(error));
		} finally {
			this.polling = false;
		}
	}

	private async execute(job: LindaCronJob): Promise<void> {
		console.log(`[Cron] executing ${job.id} (${job.name})`);
		try {
			if (job.channel !== "web") throw new Error(`cron channel not connected yet: ${job.channel}`);
			const decision =
				job.agentRole === "admin_agent"
					? await this.agents.adminAgent.decide({
							adminId: job.recipientId,
							text: job.prompt,
							channel: "web",
							metadata: { cronSkillId: job.skillId },
						})
					: await this.agents.clientAgent.decide({
							clientId: job.recipientId,
							text: job.prompt,
							channel: "web",
							metadata: { cronSkillId: job.skillId },
						});
			await this.backend.completeCronJob({
				jobId: job.id,
				runId: job.runId,
				status: "succeeded",
				result: decision.reply,
			});
			console.log(`[Cron] completed ${job.id}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[Cron] failed ${job.id}: ${message}`);
			await this.backend
				.completeCronJob({ jobId: job.id, runId: job.runId, status: "failed", error: message })
				.catch((reportError) => {
					console.error("[Cron] failed to report result:", reportError);
				});
		}
	}
}
