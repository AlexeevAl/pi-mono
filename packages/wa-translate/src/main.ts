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
import { TranslationStorage } from "./storage.js";
import { type MessageContext, TranslatorService } from "./translator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const storage = new TranslationStorage();
const translator = new TranslatorService(
	process.env.PROVIDER || "openai",
	process.env.MODEL || "gpt-5.4-mini",
	async () => process.env.OPENAI_API_KEY,
);

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

// Map language code to flag emoji
const FLAG_MAP: Record<string, string> = {
	ru: "🇷🇺",
	he: "🇮🇱",
	en: "🇺🇸",
	es: "🇪🇸",
	fr: "🇫🇷",
	de: "🇩🇪",
};

function getFlag(lang: string): string {
	return FLAG_MAP[lang.toLowerCase()] || `[${lang.toUpperCase()}]`;
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
	});

	sock.ev.on("creds.update", saveCreds);

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
		}
	});

	const mySentMessageIds = new Set<string>();

	sock.ev.on("messages.upsert", async (m: any) => {
		if (m.type !== "notify") return;

		for (const msg of m.messages) {
			if (!msg.key.remoteJid) continue;

			const chatId = msg.key.remoteJid;
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
						text: `🔛 Translation enabled. Outgoing target: ${getFlag(lang)} ${lang.toUpperCase()}`,
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
				}
				continue;
			}

			// Safety check: Never translate commands
			if (trimmedText.startsWith("/")) continue;

			let chatConfig = storage.getChatConfig(chatId);
			const context = chatContexts.get(chatId) || [];
			const detected = detectDominantLang(trimmedText);

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

					const replyText = `${getFlag("ru")} ${result.text}`;
					const sentMsg = await sock.sendMessage(chatId, { text: replyText }, { quoted: msg });
					if (sentMsg?.key?.id) mySentMessageIds.add(sentMsg.key.id);
					addContext(chatId, "assistant", result.text);
				} else if (result.reason === "error") {
					const sentMsg = await sock.sendMessage(chatId, { text: "⚠️ Translation failed." }, { quoted: msg });
					if (sentMsg?.key?.id) mySentMessageIds.add(sentMsg.key.id);
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
						const replyText = `${getFlag(targetLang)} ${result.text}`;
						const sentMsg = await sock.sendMessage(chatId, { text: replyText }, { quoted: msg });
						if (sentMsg?.key?.id) mySentMessageIds.add(sentMsg.key.id);
						addContext(chatId, "assistant", result.text);
					} else if (result.reason === "error") {
						const sentMsg = await sock.sendMessage(chatId, { text: "⚠️ Translation failed." }, { quoted: msg });
						if (sentMsg?.key?.id) mySentMessageIds.add(sentMsg.key.id);
					}
				}
			}
		}
	});
}

connectToWhatsApp();
