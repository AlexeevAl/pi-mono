import { llm } from "@livekit/agents";
import type { LindaClientAgent } from "../../agents/LindaClientAgent.js";
import type { ClientDecideInput } from "../../core/types.js";

export class LindaLLM extends llm.LLM {
	constructor(
		private readonly agent: LindaClientAgent,
		private readonly clientId: string,
	) {
		super();
	}

	label(): string {
		return "linda-agent";
	}

	get model(): string {
		return "linda-skill-agent";
	}

	get provider(): string {
		return "psf";
	}

	chat({ chatCtx, connOptions }: { chatCtx: llm.ChatContext; connOptions?: any }): llm.LLMStream {
		return new LindaLLMStream(this, this.agent, this.clientId, {
			chatCtx,
			connOptions: connOptions || { maxRetry: 0 },
		});
	}
}

class LindaLLMStream extends llm.LLMStream {
	constructor(
		public readonly llm: LindaLLM,
		public readonly agent: LindaClientAgent,
		private readonly clientId: string,
		opts: { chatCtx: llm.ChatContext; connOptions: any },
	) {
		super(llm, opts);
	}

	protected async run(): Promise<void> {
		const items = this.chatCtx.items;
		const lastUserMsg = [...items].reverse().find((m) => m.type === "message" && m.role === "user");

		if (!lastUserMsg || lastUserMsg.type !== "message") {
			return;
		}

		const text = lastUserMsg.textContent ?? "";
		if (!text) {
			return;
		}

		try {
			const input: ClientDecideInput = {
				clientId: this.clientId,
				text: text,
				channel: "livekit",
			};

			const decision = await this.agent.decide(input);

			const sentences = decision.reply.match(/[^.!?]+[.!?]*\s*/g) || [decision.reply];
			const messageId = `linda_${Date.now()}`;

			for (const sentence of sentences) {
				if (sentence.trim()) {
					this.queue.put({
						id: messageId,
						delta: {
							role: "assistant",
							content: sentence,
						},
					});
					await new Promise((r) => setTimeout(r, 50));
				}
			}
		} catch (_err: any) {
			this.queue.put({
				id: `error_${Date.now()}`,
				delta: {
					role: "assistant",
					content: "Извините, произошла техническая ошибка. Повторите, пожалуйста.",
				},
			});
		} finally {
			this.queue.close();
		}
	}
}
