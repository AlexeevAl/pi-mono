import "dotenv/config";
import baileysPkg, {
	DisconnectReason,
	fetchLatestBaileysVersion,
	useMultiFileAuthState,
} from "@whiskeysockets/baileys";

const makeWASocket = (baileysPkg as any).default || baileysPkg;

import path from "node:path";
import readline from "node:readline";
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
	const dataDir = process.env.WA_DATA_DIR || path.join(__dirname, "..");
	const authDir = path.join(dataDir, "auth_info");
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
			console.log(`[QR_CODE] ${qr}`);
			qrcode.generate(qr, { small: true });
		}

		if (connection === "close") {
			const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
			console.log("[STATUS] disconnected");
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
			console.log("[STATUS] connected");
			console.log("[WA-Translate] ✅ Connected to WhatsApp.");
			sendChatsUpdate();
		}
	});

	sock.ev.on("messages.upsert", async (m: any) => {
		if (m.type !== "notify") return;

		for (const msg of m.messages) {
			if (!msg.key.remoteJid) continue;

			const chatId = msg.key.remoteJid;
			const isFromMe = msg.key.fromMe || false;
			const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
			const trimmedText = text.trim();

			if (!trimmedText) continue;

			// Safety check: Never translate commands
			if (trimmedText.startsWith("/")) continue;

			const chatConfig = storage.getChatConfig(chatId);
			const context = chatContexts.get(chatId) || [];
			const detected = detectDominantLang(trimmedText);

			if (chatConfig?.enabled) {
				if (!isFromMe) {
					// Incoming → translate to Russian. Skip if already Russian.
					if (langMatches(detected, "Russian")) continue;

					const result = await translator.translate(
						trimmedText,
						"Russian",
						context,
						chatConfig.contactGender || "male",
					);
					if (result.ok) {
						addContext(chatId, "user", trimmedText);
						const replyText = `${getFlag("ru")} ${result.text}`;
						console.log(
							`[TRANSLATION] ${JSON.stringify({
								chatId,
								type: "incoming",
								original: trimmedText,
								translated: replyText,
								timestamp: Date.now(),
							})}`,
						);
						addContext(chatId, "assistant", result.text);
					}
				} else {
					// Outgoing message → translate to target language
					const targetLang = chatConfig.targetLang;
					const langName = targetLang.toLowerCase() === "he" ? "Hebrew" : targetLang;

					// Skip if text already in target language
					if (langMatches(detected, langName)) continue;

					const result = await translator.translate(
						trimmedText,
						langName,
						context,
						chatConfig.contactGender || "male",
					);

					if (result.ok) {
						addContext(chatId, "user", trimmedText);
						const replyText = `${getFlag(targetLang)} ${result.text}`;
						console.log(
							`[TRANSLATION] ${JSON.stringify({
								chatId,
								type: "outgoing",
								original: trimmedText,
								translated: replyText,
								timestamp: Date.now(),
							})}`,
						);
						addContext(chatId, "assistant", result.text);
					}
				}
			}
		}
	});
}

function sendChatsUpdate() {
	console.log(`[CHATS] ${JSON.stringify(storage.getState())}`);
}

// Stdin commands listener
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: false,
});

rl.on("line", (line) => {
	try {
		const msg = JSON.parse(line.trim());
		if (msg.type === "set_chat_config") {
			const { chatId, config } = msg;
			if (config.enabled) {
				storage.enableChat(chatId, config.targetLang);
			} else {
				storage.disableChat(chatId);
			}
			if (config.contactGender) {
				storage.setContactGender(chatId, config.contactGender);
			}
			sendChatsUpdate();
		} else if (msg.type === "get_chats") {
			sendChatsUpdate();
		}
	} catch (err) {
		console.error("[WA-Translate Error] Stdin message parsing failed:", err);
	}
});

connectToWhatsApp();
