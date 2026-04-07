#!/usr/bin/env node

// ============================================================================
// Linda — Entry Point
// Reads env, wires PsfClient + LindaBot + TelegramAdapter, starts.
// ============================================================================

import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { LindaBot } from "./bot.js";
import { LINDA_SYSTEM_PROMPT } from "./prompt.js";
import { PsfClient } from "./psf.js";
import { TelegramAdapter } from "./telegram.js";
import { createPsfTools } from "./tools.js";
import { LindaTui } from "./tui.js";

// ============================================================================
// Environment
// ============================================================================

function requireEnv(name: string): string {
	const val = process.env[name];
	if (!val) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return val;
}

function optionalEnv(name: string): string | undefined {
	return process.env[name] || undefined;
}

function parseApiKey(raw: string | undefined): Record<string, string> {
	if (!raw) return {};
	// Format: "provider1=key1,provider2=key2" or just a bare key for anthropic
	const entries: Record<string, string> = {};
	for (const part of raw.split(",")) {
		const eq = part.indexOf("=");
		if (eq === -1) {
			// Bare key — assume anthropic
			entries.anthropic = part.trim();
		} else {
			entries[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
		}
	}
	return entries;
}

// ============================================================================
// Bootstrap
// ============================================================================

import { loadEnvFile } from "node:process";

async function main(): Promise<void> {
	// Try loading .env from CWD
	try {
		loadEnvFile(".env");
	} catch {
		// Ignore if .env doesn't exist
	}

	// -- PSF connection --
	const psfBaseUrl = requireEnv("PSF_BASE_URL");
	const psfSecret = requireEnv("PSF_SHARED_SECRET");

	const psf = new PsfClient({
		baseUrl: psfBaseUrl,
		sharedSecret: psfSecret,
	});

	// -- Telegram --
	const telegramToken = requireEnv("TELEGRAM_BOT_TOKEN");
	const allowedIdsRaw = optionalEnv("TELEGRAM_ALLOWED_USER_IDS");
	const allowedUserIds = allowedIdsRaw
		? allowedIdsRaw
				.split(",")
				.map((s) => parseInt(s.trim(), 10))
				.filter(Boolean)
		: [];

	// -- LLM --
	const llmProvider = optionalEnv("LLM_PROVIDER") ?? "anthropic";
	const llmModel = optionalEnv("LLM_MODEL") ?? "claude-sonnet-4-5";

	// API keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, or LLM_API_KEYS=provider=key,...
	const apiKeys: Record<string, string> = {
		...parseApiKey(optionalEnv("LLM_API_KEYS")),
	};
	if (process.env.ANTHROPIC_API_KEY) {
		apiKeys.anthropic = process.env.ANTHROPIC_API_KEY;
	}
	if (process.env.OPENAI_API_KEY) {
		apiKeys.openai = process.env.OPENAI_API_KEY;
	}

	// -- TUI Mode --
	if (process.argv.includes("--tui")) {
		const tools = createPsfTools(psf, "tui_user", "tui");
		const model = getModel(llmProvider as any, llmModel);

		const agent = new Agent({
			initialState: {
				systemPrompt: LINDA_SYSTEM_PROMPT,
				model,
				thinkingLevel: "off",
				tools,
			},
			convertToLlm: (messages) =>
				messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult"),
			getApiKey: async (provider) => apiKeys[provider],
		});

		const tui = new LindaTui(agent);
		await tui.run();
		return;
	}

	// -- Assemble --
	const bot = new LindaBot({
		psf,
		provider: llmProvider,
		model: llmModel,
		getApiKey: async (provider) => apiKeys[provider],
	});

	const telegram = new TelegramAdapter(
		{
			token: telegramToken,
			allowedUserIds,
		},
		bot,
	);

	// -- Graceful shutdown --
	const shutdown = (): void => {
		console.log("\n[Linda] Shutting down…");
		telegram.stop();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// -- Start --
	await telegram.start();
}

main().catch((err) => {
	console.error("[Linda] Fatal error:", err);
	process.exit(1);
});
