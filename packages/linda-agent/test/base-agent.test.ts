import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import { extractLastAssistantText, extractTextContent, summarizeAgentMessages } from "../src/core/base-agent.js";

describe("agent response extraction", () => {
	it("extracts text content from an assistant message", () => {
		const message = asAgentMessage({
			role: "assistant",
			content: [{ type: "text", text: "Ready" }],
		});

		expect(extractTextContent(message)).toBe("Ready");
	});

	it("returns the latest assistant text when a tool result is last", () => {
		const messages = [
			asAgentMessage({ role: "user", content: "Run the task" }),
			asAgentMessage({ role: "assistant", content: [{ type: "text", text: "Task completed" }] }),
			asAgentMessage({ role: "toolResult", content: [{ type: "text", text: "receipt" }] }),
		];

		expect(extractLastAssistantText(messages)).toBe("Task completed");
	});

	it("skips empty assistant messages", () => {
		const messages = [
			asAgentMessage({ role: "assistant", content: [{ type: "text", text: "Fallback" }] }),
			asAgentMessage({ role: "assistant", content: [] }),
		];

		expect(extractLastAssistantText(messages)).toBe("Fallback");
	});

	it("summarizes message structure without including message text", () => {
		const messages = [
			asAgentMessage({ role: "user", content: "private patient text" }),
			asAgentMessage({ role: "assistant", content: [{ type: "thinking", thinking: "private reasoning" }] }),
		];

		const summary = summarizeAgentMessages(messages);

		expect(summary).toBe("user:string -> assistant:[thinking]");
		expect(summary).not.toContain("private");
	});
});

function asAgentMessage(value: unknown): AgentMessage {
	return value as AgentMessage;
}
