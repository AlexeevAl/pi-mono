// ============================================================================
// Linda — Intent Registry
//
// Business logic: intent → packId mapping lives HERE, not in the prompt.
// Add new intents by adding entries to INTENT_REGISTRY.
// ============================================================================

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
 * Returns undefined if the intent is unknown.
 */
export function resolvePackId(intent: string): string | undefined {
	// Direct match
	const entry = INTENT_REGISTRY[intent];
	if (entry) return entry.packId;

	// Legacy packId alias
	const alias = PACK_ID_ALIASES[intent];
	if (alias) return alias;

	// Try matching with _v1 suffix stripped, or as-is if it's already a packId
	for (const e of Object.values(INTENT_REGISTRY)) {
		if (e.packId === intent) return e.packId;
	}

	return undefined;
}

/**
 * Fallback: try to detect intent from raw user text using keyword matching.
 * Returns the packId or undefined.
 */
export function detectIntentFromText(text: string): string | undefined {
	const lower = text.toLowerCase();

	// Score each intent by keyword matches
	let bestIntent: string | undefined;
	let bestScore = 0;

	for (const [, entry] of Object.entries(INTENT_REGISTRY)) {
		const score = entry.keywords.filter((kw) => lower.includes(kw)).length;
		if (score > bestScore) {
			bestScore = score;
			bestIntent = entry.packId;
		}
	}

	return bestIntent;
}
