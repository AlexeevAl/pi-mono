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

/**
 * Returns the newest non-empty assistant text, ignoring trailing tool results.
 * Some providers finish a tool loop with toolResult as the last state message.
 */
export function extractLastAssistantText(messages: readonly AgentMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "assistant") continue;
		const text = extractTextContent(message);
		if (text.trim()) return text;
	}
	return "";
}

export function summarizeAgentMessages(messages: readonly AgentMessage[]): string {
	return messages
		.map((message) => {
			if (!("content" in message) || !message.content) return `${message.role}:empty`;
			if (typeof message.content === "string") return `${message.role}:string`;
			if (Array.isArray(message.content)) {
				const types = message.content
					.map((block) => (block && typeof block === "object" && "type" in block ? String(block.type) : "unknown"))
					.join(",");
				return `${message.role}:[${types}]`;
			}
			return `${message.role}:object`;
		})
		.join(" -> ");
}
