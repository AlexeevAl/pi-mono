/**
 * Shared policy hooks for both LindaClientAgent and LindaAdminAgent.
 * Subscribe these to pi-agent-core Agent events for audit/logging.
 */

export interface ToolHookContext {
	agentRole: "client_agent" | "admin_agent";
	actorId: string;
	firmId: string;
}

export function onToolExecutionStart(toolName: string, args: unknown, ctx: ToolHookContext): void {
	console.log(`[Linda:${ctx.agentRole}] tool_start name=${toolName} actor=${ctx.actorId} firm=${ctx.firmId}`, args);
}

export function onToolExecutionEnd(toolName: string, result: unknown, ctx: ToolHookContext): void {
	const ok = (result as any)?.content?.[0]?.text !== undefined;
	console.log(`[Linda:${ctx.agentRole}] tool_end name=${toolName} actor=${ctx.actorId} ok=${ok}`);
}
