import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ChatConfig {
	enabled: boolean;
	targetLang: string; // usually 'he'
	name?: string;
	contactGender?: "male" | "female";
	replyMode?: "whatsapp" | "ui" | "both";
}

export interface TranslatorState {
	chats: Record<string, ChatConfig>;
	contacts: Record<string, string>; // jid -> name
	recentChatIds: string[];
}

const DEFAULT_STATE: TranslatorState = {
	chats: {},
	contacts: {},
	recentChatIds: [],
};

export class TranslationStorage {
	private state: TranslatorState;
	private readonly filePath: string;

	constructor() {
		// Store in project root or somewhere convenient
		this.filePath = path.join(__dirname, "..", ".translator-state.json");
		this.state = this.load();
	}

	private load(): TranslatorState {
		if (fs.existsSync(this.filePath)) {
			try {
				const data = fs.readFileSync(this.filePath, "utf-8");
				const state = JSON.parse(data);
				// Migration: ensure fields exist
				if (!state.contacts) state.contacts = {};
				if (!state.recentChatIds) state.recentChatIds = [];
				return state;
			} catch (err) {
				console.error("[Storage] Failed to load state, using defaults:", err);
			}
		}
		return { ...DEFAULT_STATE };
	}

	private save(): void {
		try {
			fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
		} catch (err) {
			console.error("[Storage] Failed to save state:", err);
		}
	}

	public getChatConfig(chatId: string): ChatConfig | undefined {
		return this.state.chats[chatId];
	}

	public enableChat(chatId: string, targetLang: string = "he"): void {
		if (!this.state.chats[chatId]) {
			this.state.chats[chatId] = { enabled: true, targetLang, replyMode: "whatsapp" };
		} else {
			this.state.chats[chatId].enabled = true;
			this.state.chats[chatId].targetLang = targetLang;
		}
		this.save();
	}

	public disableChat(chatId: string): void {
		if (this.state.chats[chatId]) {
			this.state.chats[chatId].enabled = false;
			this.save();
		}
	}

	public setContactGender(chatId: string, gender: "male" | "female"): void {
		if (!this.state.chats[chatId]) {
			this.state.chats[chatId] = { enabled: false, targetLang: "he", replyMode: "whatsapp" };
		}
		this.state.chats[chatId].contactGender = gender;
		this.save();
	}

	public setReplyMode(chatId: string, mode: "whatsapp" | "ui" | "both"): void {
		if (!this.state.chats[chatId]) {
			this.state.chats[chatId] = { enabled: false, targetLang: "he", replyMode: mode };
		} else {
			this.state.chats[chatId].replyMode = mode;
		}
		this.save();
	}

	public setChatName(chatId: string, name: string): void {
		if (!name) return;

		// Always update global contacts map
		if (this.state.contacts[chatId] !== name) {
			console.log(`[Storage] Resolved name for ${chatId}: "${name}"`);
			this.state.contacts[chatId] = name;

			// Also update the specific chat config if it exists
			if (this.state.chats[chatId]) {
				this.state.chats[chatId].name = name;
			}
			this.save();
		}
	}

	public touchChat(chatId: string): void {
		const index = this.state.recentChatIds.indexOf(chatId);
		if (index !== -1) {
			this.state.recentChatIds.splice(index, 1);
		}
		this.state.recentChatIds.unshift(chatId);

		// Limit to 100 recent chats
		if (this.state.recentChatIds.length > 100) {
			this.state.recentChatIds.pop();
		}
		this.save();
	}

	public getResolvedName(chatId: string): string | undefined {
		return this.state.contacts[chatId] || this.state.chats[chatId]?.name;
	}

	public getChatList(): Array<{ id: string; name?: string }> {
		// Use a Set to avoid duplicates between configured chats and recent chats
		const allIds = new Set([...Object.keys(this.state.chats), ...this.state.recentChatIds]);

		return Array.from(allIds).map((id) => ({
			id,
			name: this.state.contacts[id] || this.state.chats[id]?.name,
		}));
	}

	public getAllChatIds(): string[] {
		return Object.keys(this.state.chats);
	}
}
