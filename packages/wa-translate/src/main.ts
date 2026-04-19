import "dotenv/config";
import baileysPkg, {
	DisconnectReason,
	fetchLatestBaileysVersion,
	useMultiFileAuthState,
} from "@whiskeysockets/baileys";

const makeWASocket = (baileysPkg as any).default || baileysPkg;

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import { TranslationServer } from "./server.js";
import { TranslationStorage } from "./storage.js";
import { type MessageContext, TranslatorService } from "./translator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const storage = new TranslationStorage();
const translator = new TranslatorService(
	process.env.PROVIDER || "openai",
	process.env.MODEL || "gpt-5.4-mini",
	async () => process.env.OPENAI_API_KEY,
);

const server = new TranslationServer();
server.onCommand((cmd, args) => {
	if (cmd === "mode") {
		console.log(`[WA-Translate] UI Command: Global reply mode set to ${args.value}`);
		// For now, let's treat this as a global override or just log it
		// In a real multi-chat scenario, we'd need to know which chat it's for.
	}
});

// Pre-fill the server with known chats from storage (with names)
server.setChatList(storage.getChatList());

server.start();

// Detect dominant script of a text. Returns the target language code (ru/he/en)
// if the text is clearly already in that language, otherwise undefined.
function detectDominantLang(text: string): "ru" | "he" | "en" | undefined {
	const letters = text.replace(/[^\p{L}]/gu, "");
	if (letters.length < 2) return undefined;
	const cyrillic = (letters.match(/[\u0400-\u04FF]/g) || []).length;
	const hebrew = (letters.match(/[\u0590-\u05FF]/g) || []).length;
	const latin = (letters.match(/[A-Za-z]/g) || []).length;
	const total = letters.length;
	if (cyrillic / total >= 0.7) return "ru";
	if (hebrew / total >= 0.7) return "he";
	if (latin / total >= 0.7) return "en";
	return undefined;
}

function langMatches(detected: "ru" | "he" | "en" | undefined, targetLang: string): boolean {
	if (!detected) return false;
	const t = targetLang.toLowerCase();
	if (detected === "ru" && (t === "ru" || t === "russian")) return true;
	if (detected === "he" && (t === "he" || t === "hebrew")) return true;
	if (detected === "en" && (t === "en" || t === "english")) return true;
	return false;
}

// In-memory context storage (last 5 messages per chat)
const chatContexts = new Map<string, MessageContext[]>();

function addContext(chatId: string, role: "user" | "assistant", content: string) {
	if (!chatContexts.has(chatId)) chatContexts.set(chatId, []);
	const ctx = chatContexts.get(chatId)!;
	ctx.push({ role, content });
	if (ctx.length > 5) ctx.shift();
}

async function connectToWhatsApp() {
	const authDir = path.join(__dirname, "..", "auth_info");
	const { state, saveCreds } = await useMultiFileAuthState(authDir);

	const { version, isLatest } = await fetchLatestBaileysVersion();
	console.log(`[WA-Translate] Using Baileys v${version.join(".")}, latest: ${isLatest}`);

	// Silence overly verbose Baileys logs
	const mockLogger: any = {
		level: "silent",
		child: () => mockLogger,
		info: () => {},
		debug: () => {},
		warn: () => {},
		error: (...args: any[]) => console.error("[WhatsApp/Baileys Error]", ...args),
		fatal: (...args: any[]) => console.error("[WhatsApp/Baileys Fatal]", ...args),
		trace: () => {},
	};

	const sock = (makeWASocket as any)({
		version,
		auth: state,
		printQRInTerminal: false,
		logger: mockLogger,
		syncFullHistory: false,
		shouldSyncHistoryMessage: () => true,
	});

	sock.ev.on("creds.update", saveCreds);

	function handleContactUpdate(id: string, name?: string) {
		if (name && name !== id) {
			storage.setChatName(id, name);
		}
		// Also ensure it's in the recent list if it's a valid chat
		if (id && (id.endsWith("@s.whatsapp.net") || id.endsWith("@g.us") || id.endsWith("@lid"))) {
			const isNew = !storage.getAllChatIds().includes(id);
			storage.touchChat(id);
			if (isNew) {
				server.setChatList(storage.getChatList());
			}
		}
	}

	sock.ev.on("messaging-history.set", (data: any) => {
		if (data.contacts) {
			console.log(`[WA-Translate] Syncing names from ${data.contacts.length} contacts...`);
			for (const contact of data.contacts) {
				handleContactUpdate(contact.id, contact.notify || contact.name);
			}
		}
		if (data.chats) {
			console.log(`[WA-Translate] Syncing ${data.chats.length} recent chats from history...`);
			for (const chat of data.chats) {
				handleContactUpdate(chat.id, chat.name);
			}
		}
	});

	sock.ev.on("contacts.upsert", (contacts: any) => {
		for (const contact of contacts) {
			handleContactUpdate(contact.id, contact.notify || contact.name);
		}
	});

	sock.ev.on("contacts.update", (updates: any) => {
		for (const update of updates) {
			handleContactUpdate(update.id, update.notify || update.name);
		}
	});

	sock.ev.on("chats.set", (data: any) => {
		if (data.chats) {
			console.log(`[WA-Translate] Syncing ${data.chats.length} chats from chats.set...`);
			for (const chat of data.chats) {
				handleContactUpdate(chat.id, chat.name);
			}
		}
	});

	sock.ev.on("chats.upsert", (chats: any) => {
		for (const chat of chats) {
			handleContactUpdate(chat.id, chat.name);
		}
	});

	sock.ev.on("chats.update", (updates: any) => {
		for (const update of updates) {
			handleContactUpdate(update.id, update.name);
		}
	});

	sock.ev.on("presence.update", (data: any) => {
		// Sometimes presence updates contain pushName
		if (data.id && data.presences) {
			const jid = data.id;
			const presence = Object.values(data.presences)[0] as any;
			if (presence?.name) {
				handleContactUpdate(jid, presence.name);
			}
		}
	});

	server.onMessageSend(async (chatId, text) => {
		console.log(`[WA-Translate] UI Message for ${chatId}: "${text}"`);
		const chatConfig = storage.getChatConfig(chatId);
		const targetLang = chatConfig?.targetLang || "he";
		const langName = targetLang.toLowerCase() === "he" ? "Hebrew" : targetLang;
		const context = chatContexts.get(chatId) || [];

		const result = await translator.translate(text, langName, context, chatConfig?.contactGender || "male");
		if (result.ok) {
			const replyText = result.text;
			await sock.sendMessage(chatId, { text: replyText });

			// Broadcast back to UI so it shows up in the feed
			server.broadcastTranslation({
				id: `ui-${Date.now()}`,
				chatId,
				chatName: storage.getResolvedName(chatId) || chatId,
				text,
				translatedText: result.text,
				targetLang: targetLang,
				timestamp: Date.now(),
				fromMe: true,
			});

			addContext(chatId, "user", text);
			addContext(chatId, "assistant", result.text);
		} else {
			console.error("[WA-Translate] Failed to translate UI message:", result);
		}
	});

	sock.ev.on("connection.update", (update: any) => {
		const { connection, lastDisconnect, qr } = update;

		if (qr) {
			console.log("[WA-Translate] Scan the QR code below to connect:");
			qrcode.generate(qr, { small: true });
		}

		if (connection === "close") {
			const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
			console.log(
				"[WA-Translate] Connection closed due to",
				lastDisconnect?.error,
				", reconnecting:",
				shouldReconnect,
			);
			if (shouldReconnect) {
				connectToWhatsApp();
			} else {
				console.log("[WA-Translate] Logged out. Please delete auth_info directory and restart.");
			}
		} else if (connection === "open") {
			console.log("[WA-Translate] ✅ Connected to WhatsApp.");

			// Proactive name resolution: subscribe to presence for all known chats
			const allChatIds = storage.getAllChatIds();
			if (allChatIds.length > 0) {
				console.log(`[WA-Translate] Probing ${allChatIds.length} contacts for names...`);
				for (const id of allChatIds) {
					sock.presenceSubscribe(id).catch(() => {});
				}
			}
		}
	});

	const mySentMessageIds = new Set<string>();

	sock.ev.on("messages.upsert", async (m: any) => {
		if (m.type !== "notify") return;

		for (const msg of m.messages) {
			if (!msg.key.remoteJid) continue;

			const chatId = msg.key.remoteJid;

			// Update activity order and ensure it's in the list
			handleContactUpdate(chatId);

			const isFromMe = msg.key.fromMe || false;
			const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
			const trimmedText = text.trim();

			if (!trimmedText) continue;

			// Skip translating our own translation replies
			if (isFromMe && mySentMessageIds.has(msg.key.id || "")) {
				mySentMessageIds.delete(msg.key.id || "");
				continue;
			}

			// Commands
			if (
				isFromMe &&
				(trimmedText.startsWith("/translate") ||
					trimmedText.startsWith("/lang") ||
					trimmedText.startsWith("/gender"))
			) {
				if (trimmedText === "/translate off") {
					storage.disableChat(chatId);
					await sock.sendMessage(chatId, { text: "📴 Translation disabled." });
				} else if (trimmedText.startsWith("/translate on") || trimmedText.startsWith("/lang")) {
					const parts = trimmedText.split(" ");
					let lang = "he";
					if (parts.length > 1 && parts[1] !== "on") lang = parts[1];
					else if (parts.length > 2) lang = parts[2];

					storage.enableChat(chatId, lang);
					await sock.sendMessage(chatId, {
						text: `🔛 Translation enabled. Outgoing target: ${lang.toUpperCase()}`,
					});
				} else if (trimmedText.startsWith("/gender")) {
					const parts = trimmedText.split(" ");
					if (parts.length > 1) {
						const g = parts[1].toLowerCase();
						if (g === "f" || g === "female" || g === "женщина") {
							storage.setContactGender(chatId, "female");
							await sock.sendMessage(chatId, {
								text: "👩 Contact gender set to FEMALE (Женщина). Translations will use feminine forms for 'you'.",
							});
						} else if (g === "m" || g === "male" || g === "мужчина") {
							storage.setContactGender(chatId, "male");
							await sock.sendMessage(chatId, {
								text: "👨 Contact gender set to MALE (Мужчина). Translations will use masculine forms for 'you'.",
							});
						}
					}
				} else if (trimmedText.startsWith("/mode")) {
					const parts = trimmedText.split(" ");
					if (parts.length > 1) {
						const mode = parts[1].toLowerCase() as "whatsapp" | "ui" | "both";
						if (mode === "whatsapp" || mode === "ui" || mode === "both") {
							storage.setReplyMode(chatId, mode);
							await sock.sendMessage(chatId, {
								text: `🔄 Reply mode set to: ${mode.toUpperCase()}`,
							});
						}
					}
				}
				continue;
			}

			// Safety check: Never translate commands
			if (trimmedText.startsWith("/")) continue;

			let chatConfig = storage.getChatConfig(chatId);
			const context = chatContexts.get(chatId) || [];
			const detected = detectDominantLang(trimmedText);
			const pushName = msg.pushName;
			if (pushName && !isFromMe) {
				handleContactUpdate(chatId, pushName);
			}

			if (!isFromMe) {
				// Incoming → translate to Russian. Skip if already Russian.
				if (langMatches(detected, "Russian")) continue;

				const result = await translator.translate(
					trimmedText,
					"Russian",
					context,
					chatConfig?.contactGender || "male",
				);
				if (result.ok) {
					addContext(chatId, "user", trimmedText);
					if (!chatConfig?.enabled) {
						console.log(`[WA-Translate] Auto-activating translation for ${chatId}`);
						storage.enableChat(chatId, "he");
						chatConfig = storage.getChatConfig(chatId);
					}

					const replyMode = chatConfig?.replyMode || "both";
					const replyText = result.text;

					// Broadcast to UI
					server.broadcastTranslation({
						id: msg.key.id || "",
						chatId,
						chatName: storage.getResolvedName(chatId) || msg.pushName || chatId,
						text: trimmedText,
						translatedText: result.text,
						targetLang: "ru",
						timestamp: Date.now(),
						fromMe: false,
					});

					if (replyMode === "whatsapp" || replyMode === "both") {
						const sentMsg = await sock.sendMessage(chatId, { text: replyText }, { quoted: msg });
						if (sentMsg?.key?.id) mySentMessageIds.add(sentMsg.key.id);
					}

					addContext(chatId, "assistant", result.text);
				} else if (result.reason === "error") {
					const replyMode = chatConfig?.replyMode || "both";
					if (replyMode === "whatsapp" || replyMode === "both") {
						const sentMsg = await sock.sendMessage(chatId, { text: "⚠️ Translation failed." }, { quoted: msg });
						if (sentMsg?.key?.id) mySentMessageIds.add(sentMsg.key.id);
					}
				}
			} else {
				// Outgoing message
				if (chatConfig?.enabled) {
					const targetLang = chatConfig.targetLang;
					const langName = targetLang.toLowerCase() === "he" ? "Hebrew" : targetLang;

					// Skip if text already in target language
					if (langMatches(detected, langName)) continue;

					console.log(`[WA-Translate] Outgoing message triggered for translation to ${targetLang}`);
					const result = await translator.translate(
						trimmedText,
						langName,
						context,
						chatConfig.contactGender || "male",
					);

					if (result.ok) {
						addContext(chatId, "user", trimmedText);
						console.log(`[WA-Translate] Sending translation: ${result.text}`);
						const replyText = result.text;
						const replyMode = chatConfig.replyMode || "both";

						// Broadcast to UI
						server.broadcastTranslation({
							id: msg.key.id || "",
							chatId,
							chatName: storage.getResolvedName(chatId) || chatId,
							text: trimmedText,
							translatedText: result.text,
							targetLang: targetLang,
							timestamp: Date.now(),
							fromMe: true,
						});

						if (replyMode === "whatsapp" || replyMode === "both") {
							const sentMsg = await sock.sendMessage(chatId, { text: replyText }, { quoted: msg });
							if (sentMsg?.key?.id) mySentMessageIds.add(sentMsg.key.id);
						}

						addContext(chatId, "assistant", result.text);
					} else if (result.reason === "error") {
						const replyMode = chatConfig.replyMode || "both";
						if (replyMode === "whatsapp" || replyMode === "both") {
							const sentMsg = await sock.sendMessage(chatId, { text: "⚠️ Translation failed." }, { quoted: msg });
							if (sentMsg?.key?.id) mySentMessageIds.add(sentMsg.key.id);
						}
					}
				}
			}
		}
	});
}

connectToWhatsApp();
