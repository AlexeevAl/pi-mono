import type { LindaAdminAgent } from "../agents/LindaAdminAgent.js";

// ============================================================================
// Minimal Telegram Bot API types (no dependency on telegraf or grammY)
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
// Channel Config
// ============================================================================

export interface TelegramChannelConfig {
	token: string;
	/** Allowlist of Telegram numeric user IDs. Empty = everyone allowed. */
	allowedUserIds?: number[];
	/** Long-poll timeout in seconds (default: 30) */
	pollTimeoutSec?: number;
}

// ============================================================================
// TelegramChannel
// ============================================================================

/**
 * Telegram Channel Adapter for LindaAdminAgent.
 *
 * Long-polling, zero external dependencies (plain fetch).
 * Routes messages and button presses to agent.decide() with adminId.
 *
 * targetClientId extraction: if the admin's message starts with a known
 * pattern like "@clientId " or [TARGET_CLIENT: ...], it is extracted and
 * forwarded as targetClientId to the agent.
 */
export class TelegramChannel {
	private readonly apiBase: string;
	private offset = 0;
	private running = false;
	private pollController: AbortController | null = null;

	constructor(
		private readonly config: TelegramChannelConfig,
		private readonly agent: LindaAdminAgent,
	) {
		this.apiBase = `https://api.telegram.org/bot${config.token}`;
	}

	// --------------------------------------------------------------------------
	// Lifecycle
	// --------------------------------------------------------------------------

	async start(): Promise<void> {
		await this.callApi("deleteWebhook", {});
		await this.registerCommands();
		this.running = true;
		console.log("[Telegram] Channel started — long-polling");
		void this.pollLoop();
	}

	stop(): void {
		this.running = false;
		this.pollController?.abort();
		console.log("[Telegram] Channel stopped");
	}

	// --------------------------------------------------------------------------
	// Commands registration
	// --------------------------------------------------------------------------

	private async registerCommands(): Promise<void> {
		try {
			await this.callApi("setMyCommands", {
				commands: [
					{ command: "sessions", description: "📋 Активные сессии клиентов" },
					{ command: "session", description: "🔍 Детали конкретной сессии" },
					{ command: "send", description: "✉️ Написать клиенту" },
					{ command: "override", description: "✏️ Изменить поле анкеты" },
					{ command: "start", description: "👋 Начать работу" },
				],
			});
		} catch (err) {
			console.error("[Telegram] Commands registration failed:", (err as Error).message);
		}
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
					// Fire-and-forget per update — serialisation is handled by LindaAdminAgent internally
					void this.handleUpdate(update).catch((err) => {
						console.error("[Telegram] handleUpdate error:", err);
					});
				}
			} catch (err: unknown) {
				if ((err as Error)?.name === "AbortError") break;
				console.error("[Telegram] Poll error:", err);
				await sleep(3000);
			}
		}
	}

	// --------------------------------------------------------------------------
	// Update dispatch
	// --------------------------------------------------------------------------

	private async handleUpdate(update: TelegramUpdate): Promise<void> {
		// Callback query (inline button press)
		if (update.callback_query) {
			const cbq = update.callback_query;
			if (!cbq.from || !cbq.data) return;
			await this.callApi("answerCallbackQuery", { callback_query_id: cbq.id }).catch(() => {});
			await this.dispatch(String(cbq.from.id), String(cbq.message?.chat.id ?? cbq.from.id), cbq.data.trim());
			return;
		}

		// Text message
		const msg = update.message;
		if (!msg || !msg.text || !msg.from) return;
		const userId = String(msg.from.id);
		const chatId = String(msg.chat.id);
		const text = msg.text.trim();
		console.log(`[Telegram] 📩 ${userId} (@${msg.from.username ?? "?"}): "${text}"`);

		// /start
		if (text === "/start") {
			await this.sendText(chatId, "Привет! Я операционный ассистент Линда. Чем помочь?");
			return;
		}

		await this.dispatch(userId, chatId, text);
	}

	// --------------------------------------------------------------------------
	// Core dispatch — maps Telegram identity to AdminDecideInput
	// --------------------------------------------------------------------------

	private async dispatch(adminId: string, chatId: string, text: string): Promise<void> {
		// Access control
		const { allowedUserIds } = this.config;
		if (allowedUserIds && allowedUserIds.length > 0 && !allowedUserIds.includes(Number(adminId))) {
			await this.sendText(chatId, "Access denied.");
			return;
		}

		await this.sendTyping(chatId);

		// Extract optional targetClientId from text patterns like "@client_123 ..."
		let targetClientId: string | undefined;
		let cleanText = text;
		const targetMatch = text.match(/^@(\S+)\s+([\s\S]+)$/);
		if (targetMatch) {
			targetClientId = targetMatch[1];
			cleanText = targetMatch[2]!.trim();
		}

		try {
			const result = await this.agent.decide({
				adminId,
				text: cleanText,
				channel: "telegram",
				targetClientId,
			});

			if (result.reply.trim()) {
				// Split long messages to stay under Telegram's 4096 char limit
				for (const chunk of splitText(result.reply.trim(), 3900)) {
					await this.sendText(chatId, chunk);
				}
			}
		} catch (err) {
			console.error("[Telegram] Agent error:", err);
			await this.sendText(chatId, "⚠️ Внутренняя ошибка. Попробуй снова.");
		}
	}

	// --------------------------------------------------------------------------
	// Telegram API helpers
	// --------------------------------------------------------------------------

	private async getUpdates(timeoutSec: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
		const url = new URL(`${this.apiBase}/getUpdates`);
		url.searchParams.set("offset", String(this.offset));
		url.searchParams.set("timeout", String(timeoutSec));
		url.searchParams.set("allowed_updates", JSON.stringify(["message", "callback_query"]));

		const res = await fetch(url.toString(), { signal });
		if (!res.ok) {
			throw new Error(`getUpdates → ${res.status}: ${await res.text()}`);
		}
		const data = (await res.json()) as TelegramResponse<TelegramUpdate[]>;
		if (!data.ok) throw new Error(`getUpdates not ok: ${data.description}`);
		return data.result;
	}

	async sendText(chatId: string, text: string): Promise<void> {
		try {
			await this.callApi("sendMessage", {
				chat_id: chatId,
				text,
				parse_mode: "Markdown",
			});
		} catch {
			// Retry without Markdown if formatting caused an API error
			await this.callApi("sendMessage", { chat_id: chatId, text }).catch(() => {});
		}
	}

	async sendTyping(chatId: string): Promise<void> {
		await this.callApi("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
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

function splitText(text: string, maxLen: number): string[] {
	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > maxLen) {
		const cut = remaining.lastIndexOf("\n", maxLen) || maxLen;
		chunks.push(remaining.slice(0, cut));
		remaining = remaining.slice(cut).trimStart();
	}
	if (remaining) chunks.push(remaining);
	return chunks;
}
