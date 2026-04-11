// ============================================================================
// Linda — Telegram Channel Adapter
// Long-polling, per-chat sequential processing via LindaBot.
// ============================================================================

import type { IncomingMessage, LindaBot } from "./bot.js";
import type { FirmConfig, LindaBridge } from "./types.js";

// ============================================================================
// Minimal Telegram Bot API types
// ============================================================================

interface TelegramUser {
	id: number;
	is_bot?: boolean;
	username?: string;
	first_name?: string;
}

interface TelegramChat {
	id: number;
	type: "private" | "group" | "supergroup" | "channel";
}

interface TelegramMessage {
	message_id: number;
	from?: TelegramUser;
	chat: TelegramChat;
	text?: string;
}

interface TelegramCallbackQuery {
	id: string;
	from?: TelegramUser;
	chat_instance?: string;
	message?: TelegramMessage;
	data?: string;
}

interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	callback_query?: TelegramCallbackQuery;
}

interface TelegramResponse<T> {
	ok: boolean;
	result: T;
	description?: string;
}

// ============================================================================
// Telegram adapter
// ============================================================================

export interface TelegramAdapterConfig {
	token: string;
	/** Admin Telegram user IDs that are allowed to use the bot (empty = everyone) */
	allowedUserIds?: number[];
	/** Long-poll timeout in seconds (default: 30) */
	pollTimeoutSec?: number;
	/** Firm config — used for /firm command */
	firm?: FirmConfig;
}

export class TelegramAdapter implements LindaBridge {
	readonly name = "telegram";

	canHandle(actorId: string): boolean {
		return actorId.startsWith("user_tg_");
	}

	async sendDirectMessage(actorId: string, text: string): Promise<boolean> {
		const chatId = actorId.replace("user_tg_", "");
		try {
			await this.callApi("sendMessage", { chat_id: chatId, text });
			return true;
		} catch (err) {
			console.error(`[Telegram] Bridge sendText error:`, err);
			return false;
		}
	}

	private readonly apiBase: string;
	private readonly config: TelegramAdapterConfig;
	private readonly bot: LindaBot;
	private offset = 0;
	private running = false;
	private pollController: AbortController | null = null;

	constructor(config: TelegramAdapterConfig, bot: LindaBot) {
		this.config = config;
		this.bot = bot;
		this.apiBase = `https://api.telegram.org/bot${config.token}`;
	}

	// --------------------------------------------------------------------------
	// Lifecycle
	// --------------------------------------------------------------------------

	async start(): Promise<void> {
		// Clear any pending webhook so long-polling works
		await this.callApi("deleteWebhook", {});

		// Register admin quick commands
		try {
			await this.callApi("setMyCommands", {
				commands: [
					{ command: "firm", description: "🏢 Настройки текущей фирмы" },
					{ command: "sessions", description: "📋 Показать список активных сессий" },
					{ command: "session", description: "🔍 Посмотреть всю информацию о конкретной сессии" },
					{ command: "send", description: "✉️ Написать сообщение клиенту (Линда спросит кому и что)" },
					{ command: "override", description: "✏️ Изменить поле в анкете клиента" },
					{ command: "reset", description: "🔄 Сбросить текущий контекст разговора" },
				],
			});
		} catch (err) {
			console.error("[Telegram] Failed to register commands:", (err as Error).message);
		}

		this.running = true;
		console.log("[Telegram] Adapter started — long-polling");
		void this.pollLoop();
	}

	stop(): void {
		this.running = false;
		this.pollController?.abort();
		console.log("[Telegram] Adapter stopped");
	}

	// --------------------------------------------------------------------------
	// Poll loop
	// --------------------------------------------------------------------------

	private async pollLoop(): Promise<void> {
		const timeoutSec = this.config.pollTimeoutSec ?? 30;

		while (this.running) {
			try {
				this.pollController = new AbortController();
				const updates = await this.getUpdates(timeoutSec, this.pollController.signal);

				for (const update of updates) {
					if (update.update_id >= this.offset) {
						this.offset = update.update_id + 1;
					}
					// Fire-and-forget per update; LindaBot serialises per chatId
					void this.handleUpdate(update).catch((err) => {
						console.error("[Telegram] handleUpdate error:", err);
					});
				}
			} catch (err: unknown) {
				if ((err as Error)?.name === "AbortError") break;
				console.error("[Telegram] Poll error:", err);
				// Back-off before retrying
				await sleep(3000);
			}
		}
	}

	// --------------------------------------------------------------------------
	// Update dispatch
	// --------------------------------------------------------------------------

	private async handleUpdate(update: TelegramUpdate): Promise<void> {
		// Handle callback query (button press)
		if (update.callback_query) {
			const cbQuery = update.callback_query;
			if (!cbQuery.from || !cbQuery.data) return;

			const userId = String(cbQuery.from.id);
			const chatId = String(cbQuery.message?.chat.id ?? cbQuery.from.id);
			const text = cbQuery.data.trim();

			// Acknowledge the callback query to remove the loading state
			await this.callApi("answerCallbackQuery", { callback_query_id: cbQuery.id }).catch(() => {});

			console.log(
				`[Telegram] 🔘 Button pressed by ${userId} (@${cbQuery.from.username ?? "no_username"}): "${text}"`,
			);

			// Access control
			if (
				this.config.allowedUserIds &&
				this.config.allowedUserIds.length > 0 &&
				!this.config.allowedUserIds.includes(cbQuery.from.id)
			) {
				return;
			}

			const incoming: IncomingMessage = {
				messageId: String(cbQuery.message?.message_id ?? Math.random()),
				chatId,
				userId,
				text,
				channel: "telegram",
				role: "admin",
				sendText: (reply, sugs) => this.sendText(chatId, reply, sugs),
				sendTyping: () => this.sendTyping(chatId),
			};

			await this.bot.handleMessage(incoming);
			return;
		}

		const msg = update.message;
		if (!msg || !msg.text || !msg.from) return;

		const userId = String(msg.from.id);
		const chatId = String(msg.chat.id);
		const text = msg.text.trim();

		console.log(`[Telegram] 📩 Incoming from ${userId} (@${msg.from.username ?? "no_username"}): "${text}"`);

		// Access control
		if (
			this.config.allowedUserIds &&
			this.config.allowedUserIds.length > 0 &&
			!this.config.allowedUserIds.includes(msg.from.id)
		) {
			return;
		}

		// /firm command — show current firm settings
		if (text === "/firm") {
			await this.sendText(chatId, this.buildFirmCard());
			return;
		}

		// /reset command
		if (text === "/reset") {
			await this.bot.resetChat(chatId, "telegram", userId);
			await this.sendText(chatId, "Session reset. What would you like help with?");
			return;
		}

		// /start command — treat as normal message so Linda greets the user
		const incomingText = text.startsWith("/start") ? "Hello" : text;

		const incoming: IncomingMessage = {
			messageId: String(msg.message_id),
			chatId,
			userId,
			text: incomingText,
			channel: "telegram",
			role: "admin",
			sendText: (reply, sugs) => this.sendText(chatId, reply, sugs),
			sendTyping: () => this.sendTyping(chatId),
		};

		await this.bot.handleMessage(incoming);
	}

	// --------------------------------------------------------------------------
	// /firm card
	// --------------------------------------------------------------------------

	private buildFirmCard(): string {
		const f = this.config.firm;
		if (!f) return "Firm config not available.";

		const packs = f.activePacks.length > 0 ? f.activePacks.join(", ") : "all (no restriction)";
		const defPack = f.defaultPackId ?? "—";
		const lang = f.language ?? "—";
		const tone = f.toneProfile ?? "warm";

		const waEnabled = f.channels.whatsappClient.enabled;
		const tgEnabled = f.channels.telegramAdmin.enabled;

		const waLine = waEnabled
			? `✅ WhatsApp (client)\n  Auth: \`${f.channels.whatsappClient.authDir}\`\n  Allowed: ${f.channels.whatsappClient.allowedUserIds.length > 0 ? f.channels.whatsappClient.allowedUserIds.join(", ") : "all"}`
			: "⬜ WhatsApp — disabled";

		const tgLine = tgEnabled
			? `✅ Telegram (admin)\n  Allowed: ${f.channels.telegramAdmin.allowedUserIds.length > 0 ? f.channels.telegramAdmin.allowedUserIds.join(", ") : "all"}`
			: "⬜ Telegram — disabled";

		return [
			`🏢 *${f.name}*`,
			`\`${f.id}\``,
			"",
			`*Packs:* ${packs}`,
			`*Default pack:* ${defPack}`,
			`*Language:* ${lang}   *Tone:* ${tone}`,
			"",
			"*Channels:*",
			waLine,
			tgLine,
		].join("\n");
	}

	// --------------------------------------------------------------------------
	// Telegram API helpers
	// --------------------------------------------------------------------------

	private async getUpdates(timeoutSec: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
		const url = new URL(`${this.apiBase}/getUpdates`);
		url.searchParams.set("offset", String(this.offset));
		url.searchParams.set("timeout", String(timeoutSec));
		url.searchParams.set("allowed_updates", JSON.stringify(["message", "callback_query"]));

		const res = await fetch(url.toString(), {
			signal,
			// Slightly longer than poll timeout so the server can respond cleanly
			headers: { "Content-Type": "application/json" },
		});

		if (!res.ok) {
			throw new Error(`getUpdates → ${res.status}: ${await res.text()}`);
		}

		const data = (await res.json()) as TelegramResponse<TelegramUpdate[]>;
		if (!data.ok) throw new Error(`getUpdates not ok: ${data.description}`);
		return data.result;
	}

	async sendText(chatId: string, text: string, suggestions?: string[]): Promise<void> {
		let reply_markup: Record<string, unknown> | undefined;

		if (suggestions && suggestions.length > 0) {
			reply_markup = {
				keyboard: suggestions.map((s) => [{ text: s }]),
				resize_keyboard: true,
				one_time_keyboard: true,
			};
		} else {
			reply_markup = {
				remove_keyboard: true,
			};
		}

		try {
			const _response = await this.callApi("sendMessage", {
				chat_id: chatId,
				text,
				parse_mode: "Markdown",
				reply_markup,
			});
		} catch (err) {
			console.error(`[Telegram] sendText error:`, err);
			// Retry without Markdown if formatting caused an error
			await this.callApi("sendMessage", { chat_id: chatId, text, reply_markup });
		}
	}

	async sendTyping(chatId: string): Promise<void> {
		await this.callApi("sendChatAction", {
			chat_id: chatId,
			action: "typing",
		}).catch(() => {});
	}

	private async callApi(method: string, body: Record<string, unknown>): Promise<unknown> {
		const res = await fetch(`${this.apiBase}/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(10_000),
		});

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`Telegram ${method} → ${res.status}: ${text.slice(0, 200)}`);
		}

		return res.json();
	}
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
