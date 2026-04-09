// ============================================================================
// Linda — Prompt Selector
// Returns the right system prompt based on agent role.
// ============================================================================

import type { AgentRole } from "../types.js";
import { ADMIN_SYSTEM_PROMPT } from "./admin.js";
import { CLIENT_SYSTEM_PROMPT } from "./client.js";

const PROMPTS: Record<AgentRole, string> = {
	client: CLIENT_SYSTEM_PROMPT,
	admin: ADMIN_SYSTEM_PROMPT,
};

export function getSystemPrompt(role: AgentRole): string {
	return PROMPTS[role];
}

export { ADMIN_SYSTEM_PROMPT } from "./admin.js";
export { CLIENT_SYSTEM_PROMPT } from "./client.js";
