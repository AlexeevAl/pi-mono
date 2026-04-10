#!/usr/bin/env node

// ============================================================================
// Linda — Entry Point
// Reads env, wires PsfClient + LindaBot + TelegramAdapter, starts.
// ============================================================================

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { LindaBot } from "./bot.js";
import { getSystemPrompt } from "./prompts/index.js";
import { PsfClient } from "./psf.js";
import { TelegramAdapter } from "./telegram.js";
import { createPsfTools } from "./tools.js";
import { LindaTui } from "./tui.js";
import type { FirmChannels, FirmConfig } from "./types.js";
import { BridgeRegistry } from "./types.js";
import { WebAdapter } from "./web.js";
import { WhatsAppAdapter } from "./whatsapp.js";

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
// Firm Config — loaded from env, one instance = one firm
// ============================================================================

function parseBool(val: string | undefined, def = false): boolean {
	if (val === undefined) return def;
	return val.toLowerCase() === "true" || val === "1";
}

function parseIds(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function parseIntIds(raw: string | undefined): number[] {
	return parseIds(raw)
		.map(Number)
		.filter((n) => !Number.isNaN(n) && n > 0);
}

/**
 * Load and validate firm config from environment variables.
 * Performs role-aware validation:
 *   - whatsappClient requires activePacks or defaultPackId (needs intent routing)
 *   - telegramAdmin requires botToken
 * Throws on misconfiguration — fail fast, don't start broken.
 */
function loadFirmConfig(): FirmConfig {
	// -- Firm identity --
	const id = requireEnv("FIRM_ID");
	const name = optionalEnv("FIRM_NAME") ?? id;
	const activePacksRaw = optionalEnv("FIRM_ACTIVE_PACKS") ?? "";
	const activePacks = activePacksRaw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const defaultPackId = optionalEnv("FIRM_DEFAULT_PACK_ID");
	const language = optionalEnv("FIRM_LANGUAGE") as FirmConfig["language"] | undefined;
	const toneProfile = optionalEnv("FIRM_TONE") as FirmConfig["toneProfile"] | undefined;

	if (defaultPackId && activePacks.length > 0 && !activePacks.includes(defaultPackId)) {
		throw new Error(
			`FIRM_DEFAULT_PACK_ID="${defaultPackId}" is not in FIRM_ACTIVE_PACKS=[${activePacks.join(", ")}]`,
		);
	}

	// -- Channel: WhatsApp client agent --
	const waEnabled = parseBool(optionalEnv("WHATSAPP_ENABLED"), true); // default on for backward compat
	const waAuthDir = optionalEnv("WHATSAPP_AUTH_DIR") ?? `./.linda/auth/${id}-whatsapp`;
	const waAllowedUserIds = parseIds(optionalEnv("WHATSAPP_ALLOWED_USER_IDS"));

	if (waEnabled && activePacks.length === 0 && !defaultPackId) {
		throw new Error(
			"WhatsApp client agent is enabled but no packs are configured. " +
				"Set FIRM_ACTIVE_PACKS or FIRM_DEFAULT_PACK_ID so clients can start a session.",
		);
	}

	// -- Channel: Telegram admin agent --
	const tgEnabled = parseBool(optionalEnv("TELEGRAM_ADMIN_ENABLED"), true); // default on for backward compat
	const tgToken = optionalEnv("TELEGRAM_BOT_TOKEN") ?? "";
	const tgAllowedUserIds = parseIntIds(optionalEnv("TELEGRAM_ALLOWED_USER_IDS"));

	if (tgEnabled && !tgToken) {
		throw new Error(
			"Telegram admin agent is enabled (TELEGRAM_ADMIN_ENABLED=true) but TELEGRAM_BOT_TOKEN is not set.",
		);
	}

	if (tgEnabled && tgAllowedUserIds.length === 0) {
		console.warn(
			"[Linda] ⚠️  Telegram admin has no TELEGRAM_ALLOWED_USER_IDS — anyone who finds the bot can act as admin.",
		);
	}

	// -- Channel: Web chat --
	const webEnabled = parseBool(optionalEnv("WEB_ENABLED"), false);
	const webPort = parseInt(optionalEnv("WEB_PORT") ?? "3034", 10);
	const webRoleRaw = optionalEnv("WEB_ROLE") ?? "client";
	const webRole = (webRoleRaw === "admin" ? "admin" : "client") as "client" | "admin";
	const webAllowedOrigins = optionalEnv("WEB_ALLOWED_ORIGINS") ?? "*";

	if (webEnabled && activePacks.length === 0 && !defaultPackId) {
		throw new Error(
			"Web chat is enabled but no packs are configured. " +
				"Set FIRM_ACTIVE_PACKS or FIRM_DEFAULT_PACK_ID so clients can start a session.",
		);
	}

	const channels: FirmChannels = {
		whatsappClient: {
			enabled: waEnabled,
			authDir: waAuthDir,
			allowedUserIds: waAllowedUserIds,
		},
		telegramAdmin: {
			enabled: tgEnabled,
			botToken: tgToken,
			allowedUserIds: tgAllowedUserIds,
		},
		webChat: {
			enabled: webEnabled,
			port: webPort,
			role: webRole,
			allowedOrigins: webAllowedOrigins,
		},
	};

	return { id, name, activePacks, defaultPackId, language, toneProfile, channels };
}

// ============================================================================
// Bootstrap
// ============================================================================

import { loadEnvFile } from "node:process";

async function main(): Promise<void> {
	// Try loading .env from CWD, then from the package root relative to this script
	const envPaths = [".env", path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env")];

	for (const envPath of envPaths) {
		try {
			loadEnvFile(envPath);
			break; // Stop after first successful load
		} catch {
			// Try next
		}
	}

	// -- Firm config (includes channel configs + validation) --
	const firm = loadFirmConfig();

	const channelSummary =
		[
			firm.channels.whatsappClient.enabled ? "WhatsApp[client]" : null,
			firm.channels.telegramAdmin.enabled ? "Telegram[admin]" : null,
			firm.channels.webChat.enabled ? `Web[${firm.channels.webChat.role}]:${firm.channels.webChat.port}` : null,
		]
			.filter(Boolean)
			.join(", ") || "no channels enabled";

	console.log(`[Linda] Firm: ${firm.name} (${firm.id})`);
	console.log(
		`[Linda] Packs: ${firm.activePacks.length > 0 ? firm.activePacks.join(", ") : "all"} | Channels: ${channelSummary}`,
	);

	const anyChannelEnabled =
		firm.channels.whatsappClient.enabled || firm.channels.telegramAdmin.enabled || firm.channels.webChat.enabled;

	if (!anyChannelEnabled) {
		throw new Error("No channels enabled. Set WHATSAPP_ENABLED, TELEGRAM_ADMIN_ENABLED, or WEB_ENABLED to true.");
	}

	// -- PSF connection --
	const psfBaseUrl = requireEnv("PSF_BASE_URL");
	const psfSecret = requireEnv("PSF_SHARED_SECRET");

	const psf = new PsfClient({
		baseUrl: psfBaseUrl,
		sharedSecret: psfSecret,
	});

	// -- LLM --
	const llmProvider = optionalEnv("LLM_PROVIDER") ?? "anthropic";
	const llmModel = optionalEnv("LLM_MODEL") ?? "claude-sonnet-4-5";

	const apiKeys: Record<string, string> = {
		...parseApiKey(optionalEnv("LLM_API_KEYS")),
	};
	if (process.env.ANTHROPIC_API_KEY) apiKeys.anthropic = process.env.ANTHROPIC_API_KEY;
	if (process.env.OPENAI_API_KEY) apiKeys.openai = process.env.OPENAI_API_KEY;

	// -- TUI Mode --
	if (process.argv.includes("--tui")) {
		const tui_role = process.argv.includes("--admin") ? ("admin" as const) : ("client" as const);
		const tools = createPsfTools(psf, "tui_user", "tui", { getCurrentStep: () => undefined }, firm);
		const model = getModel(llmProvider as any, llmModel);

		const agent = new Agent({
			initialState: {
				systemPrompt: getSystemPrompt(tui_role, firm),
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

	// -- Bridges --
	const bridgeRegistry = new BridgeRegistry();

	// -- Assemble bot --
	const bot = new LindaBot({
		psf,
		firm,
		provider: llmProvider,
		model: llmModel,
		getApiKey: async (provider) => apiKeys[provider],
		bridge: bridgeRegistry,
	});

	// -- Start adapters — conditional on firm.channels --
	const adaptersToStop: Array<{ stop: () => void }> = [];

	let telegram: TelegramAdapter | undefined;
	if (firm.channels.telegramAdmin.enabled) {
		const { botToken, allowedUserIds } = firm.channels.telegramAdmin;
		telegram = new TelegramAdapter({ token: botToken, allowedUserIds, firm }, bot);
		bridgeRegistry.register(telegram);
		adaptersToStop.push(telegram);
		console.log(
			`[Linda] Telegram admin agent: ON | allowed: ${allowedUserIds.length > 0 ? allowedUserIds.join(", ") : "all"}`,
		);
	}

	let whatsapp: WhatsAppAdapter | undefined;
	if (firm.channels.whatsappClient.enabled) {
		const { authDir, allowedUserIds } = firm.channels.whatsappClient;
		whatsapp = new WhatsAppAdapter({ authDir, allowedUserIds }, bot);
		bridgeRegistry.register(whatsapp);
		adaptersToStop.push(whatsapp);
		console.log(`[Linda] WhatsApp client agent: ON | auth: ${authDir}`);
	}

	let web: WebAdapter | undefined;
	if (firm.channels.webChat.enabled) {
		const { port, role, allowedOrigins } = firm.channels.webChat;
		web = new WebAdapter({ port, role, allowedOrigins, firmId: firm.id, firmName: firm.name }, bot);
		bridgeRegistry.register(web);
		adaptersToStop.push(web);
	}

	// -- Graceful shutdown --
	const shutdown = (): void => {
		console.log("\n[Linda] Shutting down…");
		for (const adapter of adaptersToStop) adapter.stop();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// -- Start --
	if (telegram) await telegram.start();
	if (whatsapp) await whatsapp.start();
	if (web) await web.start();
}

main().catch((err) => {
	console.error("[Linda] Fatal error:", err);
	process.exit(1);
});
