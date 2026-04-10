// ============================================================================
// Linda — Prompt Selector
// Returns the right system prompt based on agent role + optional firm config.
// Rule: only structural context goes here (firm name, language hint).
//       Business rules and policies stay in code, not in prose.
// ============================================================================

import type { AgentRole, FirmConfig } from "../types.js";
import { ADMIN_SYSTEM_PROMPT } from "./admin.js";
import { CLIENT_SYSTEM_PROMPT } from "./client.js";

const BASE_PROMPTS: Record<AgentRole, string> = {
	client: CLIENT_SYSTEM_PROMPT,
	admin: ADMIN_SYSTEM_PROMPT,
};

/**
 * Build the system prompt for an agent.
 * Prepends a firm header when a FirmConfig is provided.
 * Tone is kept minimal — only name and language hint, no policy prose.
 */
export function getSystemPrompt(role: AgentRole, firm?: FirmConfig): string {
	const base = BASE_PROMPTS[role];
	if (!firm) return base;

	const lines: string[] = [`[FIRM: ${firm.name}]`];

	if (firm.language) {
		lines.push(`[LANGUAGE: ${firm.language}]`);
	}

	if (firm.toneProfile && firm.toneProfile !== "warm") {
		// "warm" is the default — only override when explicitly different
		lines.push(`[TONE: ${firm.toneProfile}]`);
	}

	return `${lines.join("\n")}\n\n${base}`;
}

export { ADMIN_SYSTEM_PROMPT } from "./admin.js";
export { CLIENT_SYSTEM_PROMPT } from "./client.js";
