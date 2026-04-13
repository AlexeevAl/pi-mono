import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { LlmConfig } from "./types.js";

export interface CreateAgentOptions {
	llm: LlmConfig;
	systemPrompt: string;
	tools: AgentTool<any>[];
	getApiKey: (provider: string) => Promise<string | undefined>;
}

/**
 * Thin factory over pi-agent-core Agent.
 * Shared by both LindaClientAgent and LindaAdminAgent.
 * Encapsulates model wiring and text extraction.
 */
export function createAgent(options: CreateAgentOptions): Agent {
	const { llm, systemPrompt, tools, getApiKey } = options;
	const model = getModel(llm.provider as any, llm.model);

	return new Agent({
		initialState: {
			systemPrompt,
			model,
			thinkingLevel: "off",
			tools,
		},
		// Only pass message types the LLM needs
		convertToLlm: (messages) =>
			messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult"),
		getApiKey,
	});
}

/**
 * Extracts the final text response from the last agent message.
 */
export function extractTextContent(message: AgentMessage | undefined): string {
	if (!message || !("content" in message) || !message.content) return "";

	const { content } = message as { content: unknown };
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const textBlock = (content as { type: string; text?: string }[]).find((c) => c.type === "text");
		return textBlock?.text ?? "";
	}
	return "";
}
