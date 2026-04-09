import { describe, expect, it } from "vitest";
import { detectIntentFromText, resolvePackId } from "./intents.js";

describe("resolvePackId", () => {
	it("resolves known intents", () => {
		expect(resolvePackId("mortgage")).toBe("financial_v1");
		expect(resolvePackId("israel_exit")).toBe("relocation_v1");
		expect(resolvePackId("relocation")).toBe("relocation_v1");
		expect(resolvePackId("linda_relocation")).toBe("relocation_v1");
	});

	it("resolves legacy packId aliases to canonical IDs", () => {
		expect(resolvePackId("mortgage_v1")).toBe("financial_v1");
		expect(resolvePackId("israel_exit_v1")).toBe("relocation_v1");
	});

	it("returns undefined for unknown intent", () => {
		expect(resolvePackId("spaceship")).toBeUndefined();
		expect(resolvePackId("")).toBeUndefined();
	});
});

describe("detectIntentFromText", () => {
	it("detects mortgage intent", () => {
		expect(detectIntentFromText("Хочу узнать про ипотеку")).toBe("financial_v1");
		expect(detectIntentFromText("I need a mortgage")).toBe("financial_v1");
		expect(detectIntentFromText("машканта")).toBe("financial_v1");
	});

	it("detects israel exit intent (maps to relocation_v1)", () => {
		expect(detectIntentFromText("Планирую выезд из Израиля")).toBe("relocation_v1");
		expect(detectIntentFromText("leaving israel soon")).toBe("relocation_v1");
	});

	it("detects relocation intent", () => {
		expect(detectIntentFromText("Хочу переезд в другую страну")).toBe("relocation_v1");
		expect(detectIntentFromText("I'm planning relocation")).toBe("relocation_v1");
	});

	it("returns undefined for unrelated text", () => {
		expect(detectIntentFromText("Привет, как дела?")).toBeUndefined();
		expect(detectIntentFromText("What's the weather?")).toBeUndefined();
	});

	it("is case-insensitive", () => {
		expect(detectIntentFromText("ИПОТЕКА")).toBe("financial_v1");
		expect(detectIntentFromText("Mortgage")).toBe("financial_v1");
	});
});
