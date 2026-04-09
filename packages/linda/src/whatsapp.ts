// ============================================================================
// Linda — WhatsApp Channel Adapter
// Uses Baileys (@whiskeysockets/baileys) for WhatsApp Web protocol.
// ============================================================================

import type { Boom } from "@hapi/boom";
import makeWASocket, {
	DisconnectReason,
	fetchLatestBaileysVersion,
	type proto,
	useMultiFileAuthState,
	type WASocket,
} from "@whiskeysockets/baileys";
// @ts-expect-error
import QRCode from "qrcode-terminal";
import type { IncomingMessage, LindaBot } from "./bot.js";
import type { LindaBridge } from "./types.js";

export interface WhatsAppAdapterConfig {
	/** Directory to store auth state (QR code session). */
	authDir: string;
	/** Admin phone numbers (without @s.whatsapp.net) allowed to use the bot. Empty = everyone. */
	allowedUserIds?: string[];
}

export class WhatsAppAdapter implements LindaBridge {
	readonly name = "whatsapp";

	canHandle(actorId: string): boolean {
		return actorId.startsWith("user_wa_");
	}

	async sendDirectMessage(actorId: string, text: string): Promise<boolean> {
		if (!this.sock) return false;
		const phone = actorId.replace("user_wa_", "");
		const isGroup = phone.length > 15;
		const jid = `${phone}@${isGroup ? "g.us" : "s.whatsapp.net"}`;
		try {
			await this.sock.sendMessage(jid, { text });
			return true;
		} catch (err) {
			console.error(`[WhatsApp] Bridge sendText error:`, err);
			return false;
		}
	}

	private sock: WASocket | null = null;
	private readonly bot: LindaBot;
	private readonly config: WhatsAppAdapterConfig;
	private running = false;
	private isConnecting = false;
	private sentMessageIds = new Set<string>();

	constructor(config: WhatsAppAdapterConfig, bot: LindaBot) {
		this.config = config;
		this.bot = bot;
	}

	// --------------------------------------------------------------------------
	// Lifecycle
	// --------------------------------------------------------------------------

	async start(): Promise<void> {
		this.running = true;
		await this.connect();
	}

	stop(): void {
		this.running = false;
		if (this.sock) {
			this.sock.ev.removeAllListeners("connection.update");
			this.sock.ev.removeAllListeners("messages.upsert");
			this.sock.end(undefined);
			this.sock = null;
		}
		console.log("[WhatsApp] Adapter stopped");
	}

	// --------------------------------------------------------------------------
	// Connection & Auth
	// --------------------------------------------------------------------------

	private async connect(): Promise<void> {
		if (this.isConnecting) return;
		this.isConnecting = true;

		try {
			const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir);
			const { version, isLatest } = await fetchLatestBaileysVersion();
			console.log(`[WhatsApp] Using Baileys v${version.join(".")}, latest: ${isLatest}`);

			// Show errors during connection phase, silence the rest
			const mockLogger: any = {
				level: "error",
				child: () => mockLogger,
				info: () => {},
				debug: () => {},
				warn: (...args: any[]) => console.warn("[WhatsApp/Baileys]", ...args),
				error: (...args: any[]) => console.error("[WhatsApp/Baileys]", ...args),
				fatal: (...args: any[]) => console.error("[WhatsApp/Baileys FATAL]", ...args),
				trace: () => {},
			};

			this.sock = makeWASocket({
				version,
				auth: state,
				printQRInTerminal: false,
				logger: mockLogger,
			});

			this.sock.ev.on("creds.update", saveCreds);

			this.sock.ev.on("connection.update", async (update) => {
				const { connection, lastDisconnect, qr } = update;

				if (qr) {
					console.log("[WhatsApp] Scan the QR code below to log in:");
					QRCode.generate(qr, { small: true });
				}

				if (connection === "close") {
					const error = lastDisconnect?.error as Boom;
					const statusCode = error?.output?.statusCode;
					const isLoggedOut = statusCode === DisconnectReason.loggedOut;

					console.log(
						`[WhatsApp] Connection closed: ${error?.message ?? error}` +
							` (statusCode: ${statusCode ?? "none"}, loggedOut: ${isLoggedOut})`,
					);

					if (!isLoggedOut && this.running) {
						this.isConnecting = false;
						const delay = statusCode === DisconnectReason.restartRequired ? 1000 : 5000;
						console.log(`[WhatsApp] Reconnecting in ${delay}ms...`);
						setTimeout(() => this.connect(), delay);
					} else if (isLoggedOut) {
						console.log("[WhatsApp] Session logged out. Delete auth dir and restart to re-scan QR.");
						this.stop();
					} else {
						this.stop();
					}
				} else if (connection === "open") {
					console.log("[WhatsApp] Connection opened successfully");
					this.isConnecting = false;
				}
			});

			this.sock.ev.on("messages.upsert", async (m) => {
				if (m.type !== "notify") return;
				for (const msg of m.messages) {
					if (!this.running || !msg.key?.id) continue;

					// Ignore if it's a message the bot just sent
					if (this.sentMessageIds.has(msg.key.id)) {
						this.sentMessageIds.delete(msg.key.id); // Cleanup
						continue;
					}

					await this.handleIncoming(msg).catch((err) => {
						console.error("[WhatsApp] handleIncoming error:", err);
					});
				}
			});
		} catch (err) {
			console.error("[WhatsApp] Connection error:", err);
			this.isConnecting = false;
			if (this.running) {
				setTimeout(() => this.connect(), 10000);
			}
		}
	}

	// --------------------------------------------------------------------------
	// Message Handling
	// --------------------------------------------------------------------------

	private async handleIncoming(msg: proto.IWebMessageInfo): Promise<void> {
		const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
		if (!text) return;

		const chatId = msg.key?.remoteJid;
		if (!chatId) return;

		// userId is normally the phone number
		const userId = chatId.split("@")[0];

		// Access control
		if (
			this.config.allowedUserIds &&
			this.config.allowedUserIds.length > 0 &&
			!this.config.allowedUserIds.includes(userId)
		) {
			return;
		}

		const trimmedText = text.trim();
		console.log(`[WhatsApp] 📩 Incoming from ${userId}: "${trimmedText}"`);

		if (trimmedText === "/reset") {
			await this.bot.resetChat(chatId, "whatsapp", userId);
			await this.sendText(chatId, "Сессия сброшена. Давай начнём заново.");
			return;
		}

		const incoming: IncomingMessage = {
			messageId: msg.key?.id || String(Date.now()),
			chatId,
			userId,
			text: trimmedText,
			channel: "whatsapp",
			role: "client",
			sendText: (reply, sugs) => this.sendText(chatId, reply, sugs),
			sendTyping: () => this.sendTyping(chatId),
		};

		await this.bot.handleMessage(incoming);
	}

	async sendText(chatId: string, text: string, suggestions?: string[]): Promise<void> {
		if (!this.sock) return;

		let final = text;
		if (suggestions && suggestions.length > 0) {
			final += `\n\n💡 ${suggestions.map((s) => `• ${s}`).join("\n")}`;
		}

		const sent = await this.sock.sendMessage(chatId, { text: final });
		if (sent?.key?.id) {
			this.sentMessageIds.add(sent.key.id);
		}
	}

	async sendTyping(chatId: string): Promise<void> {
		if (!this.sock) return;
		await this.sock.sendPresenceUpdate("composing", chatId);
	}
}
