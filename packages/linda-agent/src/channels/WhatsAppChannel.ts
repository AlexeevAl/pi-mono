import type { Boom } from "@hapi/boom";
import makeWASocket, {
	DisconnectReason,
	fetchLatestBaileysVersion,
	type proto,
	useMultiFileAuthState,
	type WASocket,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode-terminal";
import type { LindaClientAgent } from "../agents/LindaClientAgent.js";

export interface WhatsAppChannelConfig {
	/** Directory to persist auth state (QR session). */
	authDir: string;
	/** Allowlist of phone numbers (without @s.whatsapp.net). Empty = everyone allowed. */
	allowedPhoneNumbers?: string[];
}

/**
 * WhatsApp Channel Adapter for LindaClientAgent.
 *
 * Receives messages via Baileys (WhatsApp Web protocol),
 * calls agent.decide(), and sends the reply back.
 *
 * One instance per firm. Manages reconnect/QR lifecycle internally.
 */
export class WhatsAppChannel {
	private sock: WASocket | null = null;
	private running = false;
	private isConnecting = false;
	/** Track IDs of messages we sent to avoid echo-processing them */
	private sentMessageIds = new Set<string>();

	constructor(
		private readonly config: WhatsAppChannelConfig,
		private readonly agent: LindaClientAgent,
	) {}

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
		console.log("[WhatsApp] Channel stopped");
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
			console.log(`[WhatsApp] Baileys v${version.join(".")}, latest: ${isLatest}`);

			const silentLogger: any = {
				level: "error",
				child: () => silentLogger,
				info: () => {},
				debug: () => {},
				trace: () => {},
				warn: (...args: any[]) => console.warn("[WhatsApp/Baileys]", ...args),
				error: (...args: any[]) => console.error("[WhatsApp/Baileys]", ...args),
				fatal: (...args: any[]) => console.error("[WhatsApp/Baileys FATAL]", ...args),
			};

			this.sock = makeWASocket({
				version,
				auth: state,
				printQRInTerminal: false,
				logger: silentLogger,
			});

			this.sock.ev.on("creds.update", saveCreds);

			this.sock.ev.on("connection.update", async (update) => {
				const { connection, lastDisconnect, qr } = update;

				if (qr) {
					console.log("\n[WhatsApp] ══════════════════════════════════════════");
					console.log("[WhatsApp] Scan the QR code below to log in:");
					console.log("[WhatsApp] (WhatsApp → Settings → Linked Devices → Link a Device)");
					console.log("[WhatsApp] ══════════════════════════════════════════\n");
					QRCode.generate(qr, { small: true });
					console.log("\n[WhatsApp] ══════════════════════════════════════════");
					console.log("[WhatsApp] If QR is unreadable, open this URL in browser:");
					console.log(
						`[WhatsApp] https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`,
					);
					console.log("[WhatsApp] ══════════════════════════════════════════\n");
				}

				if (connection === "close") {
					const error = lastDisconnect?.error as Boom;
					const statusCode = error?.output?.statusCode;
					const isLoggedOut = statusCode === DisconnectReason.loggedOut;

					console.log(
						`[WhatsApp] Connection closed: ${error?.message ?? ""} (code: ${statusCode ?? "none"}, loggedOut: ${isLoggedOut})`,
					);

					if (isLoggedOut) {
						console.log("[WhatsApp] Logged out. Delete auth dir and restart to re-scan QR.");
						this.stop();
					} else if (this.running) {
						this.isConnecting = false;
						const delay = statusCode === DisconnectReason.restartRequired ? 1000 : 5000;
						console.log(`[WhatsApp] Reconnecting in ${delay}ms...`);
						setTimeout(() => this.connect(), delay);
					} else {
						this.stop();
					}
				} else if (connection === "open") {
					console.log("[WhatsApp] Connected");
					this.isConnecting = false;
				}
			});

			this.sock.ev.on("messages.upsert", async (m) => {
				if (m.type !== "notify") return;
				for (const msg of m.messages) {
					if (!this.running || !msg.key?.id) continue;
					// Skip echo of messages we just sent
					if (this.sentMessageIds.has(msg.key.id)) {
						this.sentMessageIds.delete(msg.key.id);
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
				setTimeout(() => this.connect(), 10_000);
			}
		}
	}

	// --------------------------------------------------------------------------
	// Message Handling
	// --------------------------------------------------------------------------

	private async handleIncoming(msg: proto.IWebMessageInfo): Promise<void> {
		const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text;
		if (!text || !msg.key?.remoteJid) return;

		const chatId = msg.key.remoteJid;
		const userId = chatId.split("@")[0] ?? chatId;

		// Access control
		const { allowedPhoneNumbers } = this.config;
		if (allowedPhoneNumbers && allowedPhoneNumbers.length > 0 && !allowedPhoneNumbers.includes(userId)) {
			return;
		}

		const trimmed = text.trim();
		console.log(`[WhatsApp] 📩 ${userId}: "${trimmed}"`);

		// System commands
		if (trimmed === "/start" || trimmed === "Hello" || trimmed === "Привет") {
			await this.sendText(chatId, "Здравствуйте! Чем могу помочь?");
			return;
		}

		await this.sendTyping(chatId);

		try {
			const result = await this.agent.decide({
				clientId: userId,
				text: trimmed,
				channel: "whatsapp",
			});

			if (result.reply.trim()) {
				await this.sendText(chatId, result.reply);
			}
		} catch (err) {
			console.error("[WhatsApp] Agent error:", err);
			await this.sendText(chatId, "Извини, у меня временная проблема. Попробуй ещё раз через минуту.");
		}
	}

	// --------------------------------------------------------------------------
	// Send helpers
	// --------------------------------------------------------------------------

	async sendText(chatId: string, text: string): Promise<void> {
		if (!this.sock) return;
		const sent = await this.sock.sendMessage(chatId, { text });
		if (sent?.key?.id) {
			this.sentMessageIds.add(sent.key.id);
		}
	}

	async sendTyping(chatId: string): Promise<void> {
		if (!this.sock) return;
		await this.sock.sendPresenceUpdate("composing", chatId).catch(() => {});
	}
}
