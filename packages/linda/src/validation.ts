// ============================================================================
// Linda — Runtime Payload Validation
//
// Validates extractedPayload BEFORE it reaches PSF.
// Two layers:
//   1. Field-level: type checks, format, garbage detection
//   2. Step-level: required field combinations, conflicts
// ============================================================================

import type { TurnStep } from "./types.js";

// ----------------------------------------------------------------------------
// Formal rejection reason codes
// ----------------------------------------------------------------------------

export type ValidationRejectReason =
	| "empty_or_placeholder"
	| "invalid_phone"
	| "invalid_email"
	| "invalid_name"
	| "invalid_age"
	| "invalid_city"
	| "invalid_country"
	| "too_long"
	| "wrong_type"
	| "unknown_field";

// ----------------------------------------------------------------------------
// Validation result
// ----------------------------------------------------------------------------

export interface RejectedField {
	field: string;
	value: unknown;
	reason: ValidationRejectReason;
}

export interface ValidationResult {
	/** Cleaned payload (garbage removed, types coerced) */
	cleaned: Record<string, unknown>;
	/** Fields that were removed and why */
	rejected: RejectedField[];
	/** Is the cleaned payload non-empty? */
	hasData: boolean;
}

export interface StepValidationResult extends ValidationResult {
	/** Required fields still missing after validation */
	missingRequired: string[];
	/** Is payload sufficient for this step? (all required present) */
	sufficient: boolean;
}

// ----------------------------------------------------------------------------
// Known field validators — return cleaned value or undefined
// ----------------------------------------------------------------------------

type FieldValidator = (value: unknown) => { ok: true; value: unknown } | { ok: false; reason: ValidationRejectReason };

const FIELD_VALIDATORS: Record<string, FieldValidator> = {
	phone: (v) => {
		if (typeof v !== "string") return { ok: false, reason: "invalid_phone" };
		const digits = v.replace(/\D/g, "");
		return digits.length >= 7 ? { ok: true, value: v.trim() } : { ok: false, reason: "invalid_phone" };
	},

	email: (v) => {
		if (typeof v !== "string") return { ok: false, reason: "invalid_email" };
		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
			? { ok: true, value: v.trim().toLowerCase() }
			: { ok: false, reason: "invalid_email" };
	},

	name: nameValidator,
	fullName: nameValidator,
	full_name: nameValidator,
	firstName: nameValidator,
	first_name: nameValidator,
	lastName: nameValidator,
	last_name: nameValidator,

	age: (v) => {
		const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN;
		return !Number.isNaN(n) && n >= 0 && n <= 150 ? { ok: true, value: n } : { ok: false, reason: "invalid_age" };
	},

	city: shortStringValidator("invalid_city"),
	country: shortStringValidator("invalid_country"),
};

function nameValidator(v: unknown): ReturnType<FieldValidator> {
	if (typeof v !== "string") return { ok: false, reason: "invalid_name" };
	const trimmed = v.trim();
	if (trimmed.length < 2 || /^\d+$/.test(trimmed)) return { ok: false, reason: "invalid_name" };
	return { ok: true, value: trimmed };
}

function shortStringValidator(reason: ValidationRejectReason): FieldValidator {
	return (v) => {
		if (typeof v !== "string") return { ok: false, reason };
		return v.trim().length >= 2 ? { ok: true, value: v.trim() } : { ok: false, reason };
	};
}

// ----------------------------------------------------------------------------
// Garbage detection
// ----------------------------------------------------------------------------

const GARBAGE_VALUES = new Set([
	"",
	"n/a",
	"na",
	"none",
	"null",
	"undefined",
	"unknown",
	"не знаю",
	"нет данных",
	"—",
	"-",
	".",
	"...",
	"нет",
	"хз",
]);

function isGarbage(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	if (typeof value === "string") {
		if (GARBAGE_VALUES.has(value.trim().toLowerCase())) return true;
	}
	if (typeof value === "object") {
		if (Array.isArray(value) && value.length === 0) return true;
		if (!Array.isArray(value) && Object.keys(value as object).length === 0) return true;
	}
	return false;
}

// ----------------------------------------------------------------------------
// Field-level validation
// ----------------------------------------------------------------------------

export function validatePayload(payload: Record<string, unknown>): ValidationResult {
	const cleaned: Record<string, unknown> = {};
	const rejected: RejectedField[] = [];

	for (const [key, value] of Object.entries(payload)) {
		// Step 1: Garbage check
		if (isGarbage(value)) {
			rejected.push({ field: key, value, reason: "empty_or_placeholder" });
			continue;
		}

		// Step 2: Specific validator
		const validator = FIELD_VALIDATORS[key];
		if (validator) {
			const result = validator(value);
			if (result.ok) {
				cleaned[key] = result.value;
			} else {
				rejected.push({ field: key, value, reason: result.reason });
			}
			continue;
		}

		// Step 3: Generic pass-through
		if (typeof value === "string") {
			const trimmed = value.trim();
			if (trimmed.length > 1000) {
				rejected.push({ field: key, value: `[${trimmed.length} chars]`, reason: "too_long" });
			} else {
				cleaned[key] = trimmed;
			}
			continue;
		}

		if (typeof value === "number" || typeof value === "boolean") {
			cleaned[key] = value;
			continue;
		}

		// Objects/arrays pass through (PSF validates further)
		cleaned[key] = value;
	}

	return {
		cleaned,
		rejected,
		hasData: Object.keys(cleaned).length > 0,
	};
}

// ----------------------------------------------------------------------------
// Step-level validation — checks required fields from PSF step definition
// ----------------------------------------------------------------------------

export function validateForStep(payload: Record<string, unknown>, step: TurnStep): StepValidationResult {
	// First, run field-level validation
	const fieldResult = validatePayload(payload);

	// Determine which fields this step requires
	const requiredKeys = step.fields.filter((f) => f.required).map((f) => f.key);

	// Determine which fields are already collected (don't need them again)
	const alreadyCollectedKeys = new Set(Object.keys(step.alreadyCollected));

	// Missing = required but not in cleaned payload AND not already collected
	const missingRequired = requiredKeys.filter((k) => !(k in fieldResult.cleaned) && !alreadyCollectedKeys.has(k));

	// Filter out fields that don't belong to this step at all
	const stepFieldKeys = new Set(step.fields.map((f) => f.key));
	const unknownFields: RejectedField[] = [];
	const relevantCleaned: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(fieldResult.cleaned)) {
		if (stepFieldKeys.has(key)) {
			relevantCleaned[key] = value;
		} else {
			// Unknown field — keep it (PSF might accept bonus data)
			// but log it
			relevantCleaned[key] = value;
			unknownFields.push({ field: key, value: "[kept]", reason: "unknown_field" });
		}
	}

	return {
		cleaned: relevantCleaned,
		rejected: [...fieldResult.rejected, ...unknownFields],
		hasData: Object.keys(relevantCleaned).length > 0,
		missingRequired,
		sufficient: missingRequired.length === 0 && Object.keys(relevantCleaned).length > 0,
	};
}
