import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import { fauxAssistantMessage } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getAssistantTexts, getMessageText, type Harness } from "./harness.js";

interface ClaimGuardReport {
	originalText: string;
	safeText: string;
	delivery: "deliver" | "hold_for_human";
}

const UNSAFE_LEGAL_CLAIM = "Вы получите компенсацию.";
const SAFE_LEGAL_CLAIM = "Специалист проверит, подходит ли ваш случай под условия компенсации.";
const HOLD_MESSAGE = "Ответ требует проверки специалистом перед отправкой клиенту.";

function getAssistantText(message: AgentMessage): string {
	if (message.role !== "assistant") {
		return "";
	}
	return message.content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function applyClaimGuard(message: AgentMessage, reports: ClaimGuardReport[]): AgentMessage | undefined {
	if (message.role !== "assistant") {
		return undefined;
	}

	const originalText = getAssistantText(message);
	if (!originalText.includes(UNSAFE_LEGAL_CLAIM)) {
		return undefined;
	}

	const safeText = originalText.replace(UNSAFE_LEGAL_CLAIM, SAFE_LEGAL_CLAIM);
	reports.push({
		originalText,
		safeText,
		delivery: "hold_for_human",
	});

	return {
		...message,
		content: message.content.map((part) => {
			if (part.type !== "text") {
				return part;
			}
			return {
				...part,
				text: HOLD_MESSAGE,
			};
		}),
	};
}

describe("AgentSession Claim Guard integration boundary", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("guards finalized assistant text before delivery, persistence, and the next provider context", async () => {
		const reports: ClaimGuardReport[] = [];
		let followUpContext = "";
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("message_end", (event) => {
						const guardedMessage = applyClaimGuard(event.message, reports);
						if (!guardedMessage) {
							return undefined;
						}
						return { message: guardedMessage };
					});
				},
			],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(UNSAFE_LEGAL_CLAIM),
			(context) => {
				followUpContext = context.messages.map((message) => getMessageText(message)).join("\n");
				return fauxAssistantMessage("follow-up");
			},
		]);

		await harness.session.prompt("legal intake");
		await harness.session.prompt("continue");

		expect(reports).toEqual([
			{
				originalText: UNSAFE_LEGAL_CLAIM,
				safeText: SAFE_LEGAL_CLAIM,
				delivery: "hold_for_human",
			},
		]);

		const assistantTexts = getAssistantTexts(harness);
		expect(assistantTexts[0]).toBe(HOLD_MESSAGE);
		expect(assistantTexts[0]).not.toContain(UNSAFE_LEGAL_CLAIM);

		const assistantMessageEnd = harness
			.eventsOfType("message_end")
			.find((event) => event.message.role === "assistant");
		expect(assistantMessageEnd).toBeDefined();
		expect(assistantMessageEnd ? getMessageText(assistantMessageEnd.message) : "").toBe(HOLD_MESSAGE);

		const persistedAssistant = harness.sessionManager
			.getBranch()
			.find((entry) => entry.type === "message" && entry.message.role === "assistant");
		expect(persistedAssistant?.type).toBe("message");
		expect(persistedAssistant?.type === "message" ? getMessageText(persistedAssistant.message) : "").toBe(
			HOLD_MESSAGE,
		);

		expect(followUpContext).toContain(HOLD_MESSAGE);
		expect(followUpContext).not.toContain(UNSAFE_LEGAL_CLAIM);
		expect(harness.session.getLastAssistantText()).toBe("follow-up");
	});
});
