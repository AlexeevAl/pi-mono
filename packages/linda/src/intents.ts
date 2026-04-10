// ============================================================================
// Linda — Intent Registry
//
// Business logic: intent → packId mapping lives HERE, not in the prompt.
// Add new intents by adding entries to INTENT_REGISTRY.
// Per-firm overrides live in firm-intents.ts — keep this file clean.
// ============================================================================

import { FIRM_INTENT_OVERRIDES } from "./firm-intents.js";
import type { FirmConfig } from "./types.js";

export interface IntentEntry {
	packId: string;
	/** Keywords / phrases that hint at this intent (used for fallback detection) */
	keywords: string[];
}

/**
 * Canonical mapping from intent name → PSF pack ID.
 * The LLM reports an intent string; this registry resolves it to a packId.
 */
export const INTENT_REGISTRY: Record<string, IntentEntry> = {
	israel_exit: {
		packId: "relocation_v1",
		keywords: ["выезд из израил", "уехать из израил", "релокаци из израил", "leaving israel", "exit israel"],
	},
	mortgage: {
		packId: "financial_v1",
		keywords: ["ипотек", "машкант", "mortgage", "buying property", "покупка квартир"],
	},
	relocation: {
		packId: "relocation_v1",
		keywords: ["релокаци", "переезд", "relocation", "moving"],
	},
	linda_relocation: {
		packId: "relocation_v1",
		keywords: ["linda relocation"],
	},
};

/**
 * Backward-compatible aliases for old pack IDs that may still appear
 * in model tool arguments.
 */
const PACK_ID_ALIASES: Record<string, string> = {
	israel_exit_v1: "relocation_v1",
	linda_relocation_v1: "relocation_v1",
	mortgage_v1: "financial_v1",
};

/**
 * Resolve an intent string (from LLM) to a packId.
 * Firm overrides are checked first, then the global registry.
 * Returns undefined if the intent is unknown.
 */
export function resolvePackId(intent: string, firmId?: string): string | undefined {
	// Firm-level override takes priority
	if (firmId) {
		const firmEntry = FIRM_INTENT_OVERRIDES[firmId]?.[intent];
		if (firmEntry) return firmEntry.packId;
	}

	// Global registry — direct match
	const entry = INTENT_REGISTRY[intent];
	if (entry) return entry.packId;

	// Legacy packId alias
	const alias = PACK_ID_ALIASES[intent];
	if (alias) return alias;

	// PackId passthrough — if the string is already a known packId, return as-is
	for (const e of Object.values(INTENT_REGISTRY)) {
		if (e.packId === intent) return e.packId;
	}

	return undefined;
}

/**
 * Check whether a packId is permitted for this firm.
 * Empty activePacks means "all allowed" (useful for dev / single-firm setups).
 */
export function assertPackAllowed(firm: FirmConfig, packId: string): boolean {
	if (!firm.activePacks || firm.activePacks.length === 0) return true;
	return firm.activePacks.includes(packId);
}

/**
 * Fallback: try to detect intent from raw user text using keyword matching.
 * Merges firm overrides into the registry before scoring.
 * Returns the packId or undefined.
 */
export function detectIntentFromText(text: string, firmId?: string): string | undefined {
	const lower = text.toLowerCase();

	// Merge firm overrides (if any) on top of the global registry.
	// Cast is safe: Partial<Record<string, IntentEntry>> values that are undefined
	// won't be iterated — the for-of loop skips them via the keyword filter.
	const firmOverrides = firmId ? (FIRM_INTENT_OVERRIDES[firmId] ?? {}) : {};
	const effectiveRegistry = { ...INTENT_REGISTRY, ...firmOverrides } as Record<string, IntentEntry>;

	// Score each intent by keyword matches
	let bestPackId: string | undefined;
	let bestScore = 0;

	for (const [, entry] of Object.entries(effectiveRegistry)) {
		const score = entry.keywords.filter((kw) => lower.includes(kw)).length;
		if (score > bestScore) {
			bestScore = score;
			bestPackId = entry.packId;
		}
	}

	return bestPackId;
}
