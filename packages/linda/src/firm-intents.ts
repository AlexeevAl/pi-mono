// ============================================================================
// Linda — Per-Firm Intent Overrides
//
// Add a firm entry here to override the global INTENT_REGISTRY mapping.
// Each firm can remap any intent to a different packId, or add firm-specific
// keywords for fallback detection.
//
// Keep this file separate from intents.ts to avoid it becoming a graveyard
// of mixed global + per-client customisations.
//
// Format:
//   firmId → { intentKey → IntentEntry }
//
// Partial overrides are merged on top of the global registry — you only need
// to specify what differs from the default.
// ============================================================================

import type { IntentEntry } from "./intents.js";

export const FIRM_INTENT_OVERRIDES: Record<string, Partial<Record<string, IntentEntry>>> = {
	// Example — uncomment and adapt when onboarding a new firm:
	//
	// "acme_law": {
	// 	mortgage: {
	// 		packId: "acme_mortgage_v2",
	// 		keywords: ["ипотека", "mortgage", "acme loan"],
	// 	},
	// },
};
