#!/usr/bin/env node

// ============================================================================
// Linda Agent — Entry Point
// Wires LindaClientAgent (WhatsApp) + LindaAdminAgent (Telegram) and starts.
//
// Usage:
//   node dist/main.js
//   (from dev): tsx src/main.ts
//
// Required env vars: see .env.example
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

// Load .env before importing anything else
if (fs.existsSync(".env")) {
	loadDotenv();
}

import { LindaAdminAgent } from "./agents/LindaAdminAgent.js";
import { LindaClientAgent } from "./agents/LindaClientAgent.js";
import { TelegramChannel } from "./channels/TelegramChannel.js";
import { WhatsAppChannel } from "./channels/WhatsAppChannel.js";
import { buildRuntimeConfig } from "./config.js";

// ============================================================================
// Env helpers
// ============================================================================

function requireEnv(name: string): string {
	const val = process.env[name];
	if (!val) throw new Error(`Missing required env var: ${name}`);
	return val;
}

function optionalEnv(name: string): string | undefined {
	return process.env[name] || undefined;
}

function parseIds(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function parseNumericIds(raw: string | undefined): number[] {
	return parseIds(raw)
		.map(Number)
		.filter((n) => !Number.isNaN(n) && n > 0);
}

// ============================================================================
// Runtime
// ============================================================================

async function main(): Promise<void> {
	console.log("\n🤖 Linda Agent starting up...\n");

	const skillsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");

	const config = buildRuntimeConfig(skillsDir);

	console.log(`[Config] firmId       = ${config.shared.firmId}`);
	console.log(`[Config] backend      = ${config.backend.baseUrl}`);
	console.log(`[Config] llm          = ${config.llm.provider}/${config.llm.model}`);
	console.log(`[Config] locale       = ${config.shared.locale}`);
	console.log(`[Config] skillsDir    = ${config.shared.skillsDir}`);
	console.log();

	// ---- Agents ---------------------------------------------------------------

	const clientAgent = new LindaClientAgent(config);
	const adminAgent = new LindaAdminAgent(config);

	// ---- Channels -------------------------------------------------------------

	const whatsappEnabled = process.env.WHATSAPP_ENABLED !== "false";
	const telegramEnabled = process.env.TELEGRAM_ENABLED !== "false";

	const channels: Array<{ start(): Promise<void>; stop(): void }> = [];

	if (whatsappEnabled) {
		const authDir =
			optionalEnv("WHATSAPP_AUTH_DIR") ??
			path.join(process.cwd(), ".linda", "auth", `${config.shared.firmId}-whatsapp`);

		const allowedPhoneNumbers = parseIds(optionalEnv("WHATSAPP_ALLOWED_USER_IDS"));

		console.log(`[WhatsApp] authDir  = ${authDir}`);
		if (allowedPhoneNumbers.length > 0) {
			console.log(`[WhatsApp] allowlist = ${allowedPhoneNumbers.join(", ")}`);
		} else {
			console.log(`[WhatsApp] allowlist = (all numbers, set WHATSAPP_ALLOWED_USER_IDS for prod)`);
		}

		channels.push(new WhatsAppChannel({ authDir, allowedPhoneNumbers }, clientAgent));
	} else {
		console.log(`[WhatsApp] disabled (WHATSAPP_ENABLED=false)`);
	}

	if (telegramEnabled) {
		const token = requireEnv("TELEGRAM_BOT_TOKEN");
		const allowedUserIds = parseNumericIds(optionalEnv("TELEGRAM_ALLOWED_USER_IDS"));
		const pollTimeoutSec = Number(optionalEnv("TELEGRAM_POLL_TIMEOUT_SEC")) || 30;

		console.log(`[Telegram] token    = ${token.slice(0, 8)}...`);
		if (allowedUserIds.length > 0) {
			console.log(`[Telegram] allowlist = ${allowedUserIds.join(", ")}`);
		} else {
			console.log(`[Telegram] allowlist = (all users — set TELEGRAM_ALLOWED_USER_IDS for prod)`);
		}

		channels.push(new TelegramChannel({ token, allowedUserIds, pollTimeoutSec }, adminAgent));
	} else {
		console.log(`[Telegram] disabled (TELEGRAM_ENABLED=false)`);
	}

	console.log("\n");

	// ---- Graceful shutdown ----------------------------------------------------

	const shutdown = (signal: string) => {
		console.log(`\n[Linda] ${signal} received — shutting down...`);
		for (const ch of channels) {
			try {
				ch.stop();
			} catch {
				/* ignore */
			}
		}
		process.exit(0);
	};

	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));

	// ---- Start ----------------------------------------------------------------

	if (channels.length === 0) {
		console.warn("[Linda] No channels enabled — nothing to do.");
		console.warn("        Set WHATSAPP_ENABLED=true and/or TELEGRAM_ENABLED=true");
		process.exit(1);
	}

	await Promise.all(channels.map((ch) => ch.start()));
}

main().catch((err) => {
	console.error("[Linda] Fatal startup error:", err);
	process.exit(1);
});
