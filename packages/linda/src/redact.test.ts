import { describe, expect, it } from "vitest";
import { redactForLog, redactPayload, redactValue } from "./redact.js";

describe("redactValue", () => {
	// -- Known sensitive fields --

	it("masks phone field", () => {
		const result = redactValue("+7 999 123-45-67", "phone");
		expect(result).not.toContain("999");
		expect(result).toContain("***");
	});

	it("masks email field", () => {
		const result = redactValue("user@example.com", "email");
		expect(result).not.toContain("example");
		expect(result).toContain("***");
	});

	it("masks name field", () => {
		const result = redactValue("Иван Петров", "name");
		expect(result).toContain("***");
		expect(result.length).toBeLessThan("Иван Петров".length);
	});

	it("masks all name variants", () => {
		for (const field of ["fullName", "full_name", "firstName", "first_name", "lastName", "last_name"]) {
			const result = redactValue("SomeValue", field);
			expect(result).toContain("***");
		}
	});

	it("masks passport, idNumber, creditCard, bankAccount, iban, ssn", () => {
		for (const field of [
			"passport",
			"idNumber",
			"id_number",
			"teudatZehut",
			"creditCard",
			"bankAccount",
			"iban",
			"ssn",
		]) {
			expect(redactValue("sensitive_data_here", field)).toContain("***");
		}
	});

	// -- Non-string values --

	it("returns [null] for null/undefined", () => {
		expect(redactValue(null)).toBe("[null]");
		expect(redactValue(undefined)).toBe("[null]");
	});

	it("returns [number] for numbers", () => {
		expect(redactValue(42)).toBe("[number]");
	});

	it("returns boolean as string", () => {
		expect(redactValue(true)).toBe("true");
	});

	// -- Pattern-based redaction for unknown fields --

	it("redacts email patterns in free text", () => {
		const result = redactValue("contact me at user@example.com please");
		expect(result).toContain("[EMAIL_REDACTED]");
		expect(result).not.toContain("user@example.com");
	});

	it("redacts phone patterns in free text", () => {
		const result = redactValue("call me at +7-999-123-4567");
		expect(result).toContain("[PHONE_REDACTED]");
	});

	it("redacts credit card patterns", () => {
		const result = redactValue("card: 4111 1111 1111 1111");
		expect(result).toContain("[CC_REDACTED]");
	});

	it("redacts Israeli ID (9 digits)", () => {
		const result = redactValue("my ID is 123456789 thanks");
		expect(result).toContain("[ID_REDACTED]");
	});

	it("leaves clean text untouched", () => {
		const result = redactValue("I want to move to Berlin");
		expect(result).toBe("I want to move to Berlin");
	});
});

describe("redactPayload", () => {
	it("redacts all values by field name", () => {
		const result = redactPayload({
			name: "Иван Петров",
			phone: "+79991234567",
			email: "ivan@mail.ru",
			city: "Москва",
		});
		expect(result.name).toContain("***");
		expect(result.phone).toContain("***");
		expect(result.email).toContain("***");
		// city is not in sensitive list, but has no PII patterns
		expect(result.city).toBe("Москва");
	});
});

describe("redactForLog", () => {
	it("masks middle of long strings", () => {
		const result = redactForLog("1234567890", "userId");
		expect(result).toBe("1234***90");
	});

	it("returns short strings as-is", () => {
		expect(redactForLog("abc", "userId")).toBe("abc");
	});
});
