import { fileURLToPath } from "node:url";

// ============================================================================
// Linda Agent — Entry Point
// Wires LindaClientAgent (WhatsApp) + LindaAdminAgent (Telegram) and starts.
//
// Usage:
//   node dist/main.js
//   (from dev): tsgo -p tsconfig.build.json --watch
//
// Required env vars: see .env.example
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

// Load .env before importing anything else
if (fs.existsSync(".env")) {
	loadDotenv();
}

// Load settings.json if exists (overrides .env)
const settingsPath = path.join(process.cwd(), "settings.json");
if (fs.existsSync(settingsPath)) {
	try {
		const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
		if (settings.telegramToken) process.env.TELEGRAM_BOT_TOKEN = settings.telegramToken;
		if (settings.telegramAllowedIds) {
			process.env.TELEGRAM_ALLOWED_USER_IDS = Array.isArray(settings.telegramAllowedIds)
				? settings.telegramAllowedIds.join(",")
				: settings.telegramAllowedIds;
		}
		console.log(`[Config] Loaded overrides from ${settingsPath}`);
	} catch (err) {
		console.warn(`[Config] Failed to parse ${settingsPath}:`, err);
	}
}

import { LindaAdminAgent } from "./agents/LindaAdminAgent.js";
// ... (rest of imports)
import { LindaClientAgent } from "./agents/LindaClientAgent.js";
import { TelegramChannel } from "./channels/TelegramChannel.js";
import { WebChannel } from "./channels/WebChannel.js";
import { WhatsAppChannel } from "./channels/WhatsAppChannel.js";
import { buildRuntimeConfig } from "./config.js";
import { ClinicBackendClient } from "./core/backend-client.js";
import { applyAgentRuntimeConfig } from "./runtime-config.js";

// ============================================================================
// Env helpers
// ============================================================================

function _requireEnv(name: string): string {
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

function parseBoolean(raw: string | undefined, defaultValue: boolean): boolean {
	if (raw === undefined) return defaultValue;
	return raw === "true" || raw === "1";
}

// ============================================================================
// Runtime
// ============================================================================

async function main(): Promise<void> {
	const skillsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");

	let config = buildRuntimeConfig(skillsDir);

	try {
		const remoteRuntime = await new ClinicBackendClient(config.backend).getAgentRuntimeConfig();
		config = applyAgentRuntimeConfig(config, remoteRuntime);
		console.log(`[Config] runtime     = fetched from backend (${remoteRuntime.generatedAt ?? "no timestamp"})`);
	} catch (err) {
		const required = parseBoolean(optionalEnv("LINDA_RUNTIME_CONFIG_REQUIRED"), false);
		const message = err instanceof Error ? err.message : String(err);
		if (required) {
			throw new Error(`Failed to fetch required runtime config: ${message}`);
		}
		console.warn(`[Config] runtime     = env fallback (${message})`);
	}

	console.log(`[Config] firmId       = ${config.shared.firmId}`);
	console.log(`[Config] backend      = ${config.backend.baseUrl}`);
	console.log(`[Config] llm          = ${config.llm.provider}/${config.llm.model}`);
	console.log(`[Config] locale       = ${config.shared.locale}`);
	console.log(`[Config] skillsDir    = ${config.shared.skillsDir}`);
	console.log(`[Config] clientAgent  = ${config.clientAgent.enabled ? "enabled" : "disabled"}`);
	console.log(`[Config] firmAgent    = ${config.adminAgent.enabled ? "enabled" : "disabled"}`);
	if (config.shared.remoteRuntime) {
		console.log(
			`[Config] catalog      = ${config.shared.remoteRuntime.clinicCatalog.enabled ? "enabled" : "disabled"} (${config.shared.remoteRuntime.clinicCatalog.itemCount} items)`,
		);
	}
	console.log();

	// ---- Agents ---------------------------------------------------------------

	const clientAgent = new LindaClientAgent(config);
	const adminAgent = new LindaAdminAgent(config);

	// ---- Channels -------------------------------------------------------------

	const whatsappEnabled =
		process.env.WHATSAPP_ENABLED !== "false" && config.clientAgent.enabled && config.clientAgent.channels.whatsapp;
	const telegramEnabled =
		process.env.TELEGRAM_ENABLED !== "false" && config.adminAgent.enabled && config.adminAgent.channels.telegram;
	const webEnabled = parseBoolean(optionalEnv("WEB_ENABLED"), false);

	const channels: Array<{ start(): Promise<void>; stop(): void }> = [];
	let whatsappChannel: WhatsAppChannel | undefined;
	let telegramChannel: TelegramChannel | undefined;

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

		whatsappChannel = new WhatsAppChannel({ authDir, allowedPhoneNumbers }, clientAgent);
		channels.push(whatsappChannel);
	} else {
		console.log(`[WhatsApp] disabled (WHATSAPP_ENABLED=false)`);
	}

	if (telegramEnabled) {
		const token = optionalEnv("TELEGRAM_BOT_TOKEN");
		if (!token) {
			console.warn(
				"[Telegram] WARNING: TELEGRAM_BOT_TOKEN is missing. Telegram channel will be disabled until configured.",
			);
		} else {
			const allowedUserIds = parseNumericIds(optionalEnv("TELEGRAM_ALLOWED_USER_IDS"));
			const pollTimeoutSec = Number(optionalEnv("TELEGRAM_POLL_TIMEOUT_SEC")) || 30;

			console.log(`[Telegram] token    = ${token.slice(0, 8)}...`);
			if (allowedUserIds.length > 0) {
				console.log(`[Telegram] allowlist = ${allowedUserIds.join(", ")}`);
			} else {
				console.log(`[Telegram] allowlist = (all users — set TELEGRAM_ALLOWED_USER_IDS for prod)`);
			}

			telegramChannel = new TelegramChannel({ token, allowedUserIds, pollTimeoutSec }, adminAgent);
			channels.push(telegramChannel);
		}
	} else {
		console.log(`[Telegram] disabled (TELEGRAM_ENABLED=false)`);
	}

	if (webEnabled) {
		const webRole = optionalEnv("WEB_ROLE") === "admin" ? "admin" : "client";
		const webRoleEnabled =
			webRole === "admin"
				? config.adminAgent.enabled && config.adminAgent.channels.web
				: config.clientAgent.enabled && config.clientAgent.channels.web;

		if (!webRoleEnabled) {
			console.log(`[Web] disabled by firm runtime config (role=${webRole})`);
		} else {
			const webPort = Number(optionalEnv("WEB_PORT")) || 3034;
			const allowedOrigins = optionalEnv("WEB_ALLOWED_ORIGINS") ?? "*";
			const defaultActorId = optionalEnv("WEB_DEFAULT_ACTOR_ID");
			const firmName = optionalEnv("FIRM_NAME") ?? config.shared.firmId;

			console.log(`[Web] role       = ${webRole}`);
			console.log(`[Web] port       = ${webPort}`);
			console.log(`[Web] origins    = ${allowedOrigins}`);
			if (defaultActorId) {
				console.log(`[Web] actorId    = ${defaultActorId}`);
			}

			channels.push(
				new WebChannel(
					{
						port: webPort,
						role: webRole,
						allowedOrigins,
						firmName,
						defaultActorId,
						backend: config.backend,
					},
					{
						clientAgent,
						adminAgent,
					},
					{
						whatsapp: whatsappChannel,
						telegram: telegramChannel,
					},
				),
			);
		}
	} else {
		console.log(`[Web] disabled (WEB_ENABLED=false)`);
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
		console.warn("        Set WHATSAPP_ENABLED=true, TELEGRAM_ENABLED=true, or WEB_ENABLED=true");
		process.exit(1);
	}

	await Promise.all(channels.map((ch) => ch.start()));
}

main().catch((err) => {
	console.error("[Linda] Fatal startup error:", err);
	process.exit(1);
});
