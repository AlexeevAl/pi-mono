// ============================================================================
// Linda — PII Redaction
//
// Masks sensitive data before it enters structured logs.
// Principle: logs should NEVER contain raw PII.
// ============================================================================

// ----------------------------------------------------------------------------
// Redaction patterns
// ----------------------------------------------------------------------------

const PHONE_PATTERN = /(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{2,4}[-.\s]?\d{2,6}/g;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
// Israeli ID (teudat zehut): 9 digits
const IL_ID_PATTERN = /\b\d{9}\b/g;
// Credit card-like: 4 groups of 4 digits
const CC_PATTERN = /\b\d{4}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/g;
// Passport-like: letter followed by 7-8 digits
const PASSPORT_PATTERN = /\b[A-Z]\d{7,8}\b/gi;

// ----------------------------------------------------------------------------
// Per-field redaction for known field types
// ----------------------------------------------------------------------------

const SENSITIVE_FIELDS = new Set([
	"phone",
	"email",
	"fullName",
	"full_name",
	"firstName",
	"first_name",
	"lastName",
	"last_name",
	"name",
	"address",
	"passport",
	"idNumber",
	"id_number",
	"teudatZehut",
	"teudat_zehut",
	"creditCard",
	"credit_card",
	"bankAccount",
	"bank_account",
	"iban",
	"ssn",
]);

/**
 * Redact a value for log output.
 * - Known sensitive fields → masked
 * - Unknown fields → pattern-based redaction
 * - Non-string values → type indicator only
 */
export function redactValue(value: unknown, fieldName?: string): string {
	if (value === null || value === undefined) return "[null]";

	if (typeof value === "number") return "[number]";
	if (typeof value === "boolean") return String(value);

	if (typeof value !== "string") return `[${typeof value}]`;

	const str = value as string;

	// Known sensitive field — always mask
	if (fieldName && SENSITIVE_FIELDS.has(fieldName)) {
		return maskString(str);
	}

	// Pattern-based redaction for unknown fields
	return redactPatterns(str);
}

/**
 * Redact an entire payload object.
 * Returns a safe-for-logging version with PII masked.
 */
export function redactPayload(payload: Record<string, unknown>): Record<string, string> {
	const redacted: Record<string, string> = {};
	for (const [key, value] of Object.entries(payload)) {
		redacted[key] = redactValue(value, key);
	}
	return redacted;
}

/**
 * Light redaction for identifiers (userId, chatId).
 * Shows first 4 chars + last 2, rest masked.
 */
export function redactForLog(value: string, _fieldHint: string): string {
	if (value.length <= 6) return value; // too short to mask meaningfully
	return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

function maskString(str: string): string {
	if (str.length <= 3) return "***";
	if (str.length <= 6) return `${str[0]}***${str[str.length - 1]}`;
	return `${str.slice(0, 2)}***${str.slice(-2)}`;
}

function redactPatterns(text: string): string {
	let result = text;
	// Order matters: more specific patterns first
	result = result.replace(CC_PATTERN, "[CC_REDACTED]");
	result = result.replace(EMAIL_PATTERN, "[EMAIL_REDACTED]");
	result = result.replace(PASSPORT_PATTERN, "[PASSPORT_REDACTED]");
	// IL ID (9 digits) BEFORE phone — phone pattern is greedier
	result = result.replace(IL_ID_PATTERN, "[ID_REDACTED]");
	result = result.replace(PHONE_PATTERN, "[PHONE_REDACTED]");
	return result;
}
