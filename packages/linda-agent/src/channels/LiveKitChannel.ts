import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentServer, initializeLogger, ServerOptions } from "@livekit/agents";
import type { LindaClientAgent } from "../agents/LindaClientAgent.js";

export interface LiveKitChannelConfig {
	url: string;
	apiKey: string;
	apiSecret: string;
}

/**
 * LiveKit Channel Adapter for LindaClientAgent.
 *
 * Runs a LiveKit AgentServer (Worker) that listens for room assignments.
 * The actual agent logic resides in agent-entry.ts which is spawned as a child process.
 */
export class LiveKitChannel {
	private worker: AgentServer | null = null;
	private running = false;

	constructor(
		private readonly config: LiveKitChannelConfig,
		_agent: LindaClientAgent, // Kept for interface consistency, but agent logic is in agent-entry.ts
	) {}

	async start(): Promise<void> {
		this.running = true;

		// The path must point to the compiled .js file in dist
		const agentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "livekit", "agent-entry.js");

		initializeLogger({ pretty: true, level: "debug" });

		const agentName = process.env.LIVEKIT_AGENT_NAME || "linda";
		const options = new ServerOptions({
			agent: agentPath,
			agentName,
			wsURL: this.config.url,
			apiKey: this.config.apiKey,
			apiSecret: this.config.apiSecret,
			logLevel: "debug",
			requestFunc: async (req) => {
				console.log(`[LiveKit] Accepting job ${req.id} for agent ${agentName}`);
				await req.accept("Linda", "linda");
			},
		});

		this.worker = new AgentServer(options);

		console.log(`[LiveKit] Starting worker "${agentName}" in DEBUG mode...`);
		// run() starts the worker loop
		await this.worker.run().catch((err) => {
			if (this.running) {
				console.error("[LiveKit] Worker run error:", err);
			}
		});
	}

	stop(): void {
		this.running = false;
		if (this.worker) {
			this.worker.close().catch(() => {});
			console.log("[LiveKit] Channel stopped");
		}
	}
}
