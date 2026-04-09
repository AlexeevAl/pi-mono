import { describe, expect, it } from "vitest";
import type { TurnStep } from "./types.js";
import { validateForStep, validatePayload } from "./validation.js";

// ============================================================================
// Field-level validation
// ============================================================================

describe("validatePayload", () => {
	// -- Garbage detection --

	it("rejects null/undefined values", () => {
		const result = validatePayload({ a: null, b: undefined });
		expect(result.hasData).toBe(false);
		expect(result.rejected).toHaveLength(2);
		expect(result.rejected[0].reason).toBe("empty_or_placeholder");
	});

	it("rejects placeholder strings", () => {
		const result = validatePayload({
			a: "n/a",
			b: "не знаю",
			c: "null",
			d: "",
			e: "—",
			f: "хз",
		});
		expect(result.hasData).toBe(false);
		expect(result.rejected).toHaveLength(6);
		for (const r of result.rejected) {
			expect(r.reason).toBe("empty_or_placeholder");
		}
	});

	it("rejects empty objects and arrays", () => {
		const result = validatePayload({ a: {}, b: [] });
		expect(result.hasData).toBe(false);
	});

	// -- Phone validation --

	it("accepts valid phone numbers", () => {
		const result = validatePayload({ phone: "+7 999 123-45-67" });
		expect(result.hasData).toBe(true);
		expect(result.cleaned.phone).toBe("+7 999 123-45-67");
	});

	it("rejects short phone numbers", () => {
		const result = validatePayload({ phone: "123" });
		expect(result.hasData).toBe(false);
		expect(result.rejected[0].reason).toBe("invalid_phone");
	});

	it("rejects non-string phone", () => {
		const result = validatePayload({ phone: 12345678 });
		expect(result.rejected[0].reason).toBe("invalid_phone");
	});

	// -- Email validation --

	it("accepts valid email and lowercases it", () => {
		const result = validatePayload({ email: "  User@Example.COM  " });
		expect(result.cleaned.email).toBe("user@example.com");
	});

	it("rejects invalid email", () => {
		const result = validatePayload({ email: "not-an-email" });
		expect(result.rejected[0].reason).toBe("invalid_email");
	});

	// -- Name validation --

	it("accepts valid names", () => {
		const result = validatePayload({ name: "Алексей" });
		expect(result.cleaned.name).toBe("Алексей");
	});

	it("rejects single-char names", () => {
		const result = validatePayload({ name: "A" });
		expect(result.rejected[0].reason).toBe("invalid_name");
	});

	it("rejects all-digit names", () => {
		const result = validatePayload({ name: "12345" });
		expect(result.rejected[0].reason).toBe("invalid_name");
	});

	it("validates all name field variants", () => {
		const result = validatePayload({
			fullName: "John Doe",
			full_name: "Jane Doe",
			firstName: "John",
			first_name: "Jane",
			lastName: "Doe",
			last_name: "Smith",
		});
		expect(Object.keys(result.cleaned)).toHaveLength(6);
	});

	// -- Age validation --

	it("accepts valid age as number", () => {
		const result = validatePayload({ age: 35 });
		expect(result.cleaned.age).toBe(35);
	});

	it("accepts valid age as string", () => {
		const result = validatePayload({ age: "28" });
		expect(result.cleaned.age).toBe(28);
	});

	it("rejects age out of range", () => {
		expect(validatePayload({ age: -1 }).rejected[0].reason).toBe("invalid_age");
		expect(validatePayload({ age: 200 }).rejected[0].reason).toBe("invalid_age");
	});

	// -- City/country --

	it("accepts valid city", () => {
		const result = validatePayload({ city: "Москва" });
		expect(result.cleaned.city).toBe("Москва");
	});

	it("rejects single-char city", () => {
		expect(validatePayload({ city: "M" }).rejected[0].reason).toBe("invalid_city");
	});

	// -- Generic fields --

	it("passes through unknown string fields with trim", () => {
		const result = validatePayload({ notes: "  some text  " });
		expect(result.cleaned.notes).toBe("some text");
	});

	it("rejects strings over 1000 chars", () => {
		const result = validatePayload({ notes: "x".repeat(1001) });
		expect(result.rejected[0].reason).toBe("too_long");
	});

	it("passes through numbers and booleans", () => {
		const result = validatePayload({ count: 42, active: true });
		expect(result.cleaned.count).toBe(42);
		expect(result.cleaned.active).toBe(true);
	});

	// -- Mixed payload --

	it("handles mixed valid and invalid fields", () => {
		const result = validatePayload({
			name: "Иван",
			phone: "123", // too short
			email: "ivan@mail.ru",
			notes: "n/a", // garbage
			city: "Тель-Авив",
		});
		expect(result.hasData).toBe(true);
		expect(Object.keys(result.cleaned)).toEqual(expect.arrayContaining(["name", "email", "city"]));
		expect(result.rejected).toHaveLength(2);
		expect(result.rejected.map((r) => r.field).sort()).toEqual(["notes", "phone"]);
	});
});

// ============================================================================
// Step-level validation
// ============================================================================

describe("validateForStep", () => {
	const makeStep = (overrides?: Partial<TurnStep>): TurnStep => ({
		id: "collect_contact",
		kind: "collect",
		fields: [
			{ key: "name", label: "Full name", required: true },
			{ key: "phone", label: "Phone", required: true },
			{ key: "email", label: "Email", required: false },
		],
		alreadyCollected: {},
		...overrides,
	});

	it("reports missing required fields", () => {
		const result = validateForStep({ email: "a@b.com" }, makeStep());
		expect(result.missingRequired).toEqual(expect.arrayContaining(["name", "phone"]));
		expect(result.sufficient).toBe(false);
	});

	it("is sufficient when all required fields present", () => {
		const result = validateForStep({ name: "Иван", phone: "+79991234567" }, makeStep());
		expect(result.missingRequired).toHaveLength(0);
		expect(result.sufficient).toBe(true);
	});

	it("does not require already collected fields", () => {
		const step = makeStep({
			alreadyCollected: { name: "Иван" },
		});
		const result = validateForStep({ phone: "+79991234567" }, step);
		expect(result.missingRequired).toHaveLength(0);
		expect(result.sufficient).toBe(true);
	});

	it("marks unknown fields as unknown_field but keeps them", () => {
		const result = validateForStep({ name: "Иван", phone: "+79991234567", favoriteColor: "blue" }, makeStep());
		expect(result.cleaned.favoriteColor).toBe("blue");
		expect(result.rejected.find((r) => r.reason === "unknown_field")).toBeTruthy();
	});

	it("combines field-level rejection with step-level missing", () => {
		const result = validateForStep(
			{ name: "A", phone: "123" }, // both invalid
			makeStep(),
		);
		expect(result.hasData).toBe(false);
		expect(result.missingRequired).toEqual(expect.arrayContaining(["name", "phone"]));
		expect(result.rejected.map((r) => r.reason)).toEqual(expect.arrayContaining(["invalid_name", "invalid_phone"]));
	});
});
