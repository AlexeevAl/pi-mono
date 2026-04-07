// ============================================================================
// Linda — Telegram Channel Adapter
// Long-polling, per-chat sequential processing via LindaBot.
// ============================================================================

import type { IncomingMessage, LindaBot } from "./bot.js";

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

interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
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
}

export class TelegramAdapter {
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
			sendText: (reply, sugs) => this.sendText(chatId, reply, sugs),
			sendTyping: () => this.sendTyping(chatId),
		};

		await this.bot.handleMessage(incoming);
	}

	// --------------------------------------------------------------------------
	// Telegram API helpers
	// --------------------------------------------------------------------------

	private async getUpdates(timeoutSec: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
		const url = new URL(`${this.apiBase}/getUpdates`);
		url.searchParams.set("offset", String(this.offset));
		url.searchParams.set("timeout", String(timeoutSec));
		url.searchParams.set("allowed_updates", JSON.stringify(["message"]));

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
		const reply_markup =
			suggestions && suggestions.length > 0
				? {
						keyboard: suggestions.map((s) => [{ text: s }]),
						resize_keyboard: true,
						one_time_keyboard: true,
					}
				: {
						remove_keyboard: true,
					};

		await this.callApi("sendMessage", {
			chat_id: chatId,
			text,
			parse_mode: "Markdown",
			reply_markup,
		}).catch(async () => {
			// Retry without Markdown if formatting caused an error
			await this.callApi("sendMessage", { chat_id: chatId, text, reply_markup });
		});
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
