// ============================================================================
// Linda — System Prompt (backward-compat re-export)
// Real prompts live in ./prompts/client.ts and ./prompts/admin.ts
// ============================================================================

export { CLIENT_SYSTEM_PROMPT as LINDA_SYSTEM_PROMPT } from "./prompts/client.js";
export { getSystemPrompt } from "./prompts/index.js";
