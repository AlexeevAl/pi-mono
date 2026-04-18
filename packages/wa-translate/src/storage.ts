import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ChatConfig {
	enabled: boolean;
	targetLang: string; // usually 'he'
	contactGender?: "male" | "female";
}

export interface TranslatorState {
	chats: Record<string, ChatConfig>;
}

const DEFAULT_STATE: TranslatorState = {
	chats: {},
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
				return JSON.parse(data);
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
		this.state.chats[chatId] = { enabled: true, targetLang };
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
			this.state.chats[chatId] = { enabled: false, targetLang: "he" };
		}
		this.state.chats[chatId].contactGender = gender;
		this.save();
	}
}
