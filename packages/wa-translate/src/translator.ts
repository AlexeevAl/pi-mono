import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { complete, getModel, type Model } from "@mariozechner/pi-ai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface MessageContext {
	role: "user" | "assistant" | "system";
	content: string;
}

export type TranslateResult =
	| { ok: true; text: string }
	| { ok: false; reason: "no-response" | "error"; error?: unknown };

export class TranslatorService {
	private model: Model<any>;
	private systemPrompt: string;
	private getApiKey?: (provider: string) => Promise<string | undefined>;

	constructor(provider: string, modelName: string, getApiKey?: (provider: string) => Promise<string | undefined>) {
		this.model = getModel(provider as any, modelName);
		this.getApiKey = getApiKey;

		const skillPath = path.join(__dirname, "skills", "translator", "SKILL.md");
		this.systemPrompt = fs.readFileSync(skillPath, "utf-8");
	}

	private async completeOptions(): Promise<{ temperature: number; apiKey?: string }> {
		const opts: { temperature: number; apiKey?: string } = { temperature: 0 };
		if (this.getApiKey) {
			const key = await this.getApiKey(this.model.provider);
			if (key) opts.apiKey = key;
		}
		return opts;
	}

	public async translate(
		text: string,
		targetLang: string,
		context: MessageContext[] = [],
		contactGender: "male" | "female" = "male",
	): Promise<TranslateResult> {
		try {
			let historyStr = "";
			if (context.length > 0) {
				historyStr =
					"Previous conversation history for context (do NOT translate this, use only for context like gender/pronouns/topic):\n";
				for (const ctx of context) {
					historyStr += `[${ctx.role === "user" ? "UserMsg" : "TranslatedMsg"}]: ${ctx.content}\n`;
				}
				historyStr += "\n";
			}

			const genderInstr = `ATTENTION: The person the user is talking to is ${contactGender.toUpperCase()}. Use appropriate verbs and pronouns for ${contactGender} recipient.\n\n`;
			const prompt = `${historyStr}${genderInstr}Translate the following text into ${targetLang}. Text to translate:\n"${text}"`;

			const messages: MessageContext[] = [{ role: "user", content: `${this.systemPrompt}\n\nTASK:\n${prompt}` }];

			const options = await this.completeOptions();
			const message = await complete(this.model, { messages: messages as any[] }, options);

			let result = "";
			for (const block of message.content) {
				if (block.type === "text") result += block.text;
			}

			let trimmed = result.trim();
			console.log(`[Translator] LLM Raw Output: "${result}"`);
			if (trimmed.toUpperCase() === "NO_RESPONSE" || trimmed === "") {
				return { ok: false, reason: "no-response" };
			}

			// If target is not Russian but output still contains Cyrillic, retry with explicit correction
			const hasCyrillic = /[\u0400-\u04FF]/.test(trimmed);
			if (hasCyrillic && targetLang.toLowerCase() !== "russian" && targetLang.toLowerCase() !== "ru") {
				console.log(`[Translator] Cyrillic detected in non-Russian output, retrying with explicit instruction`);
				const retryMessages: MessageContext[] = [
					{
						role: "user",
						content: `${this.systemPrompt}\n\nTASK:\n${historyStr}${genderInstr}Translate the following text into ${targetLang}. Text to translate:\n"${text}"\n\nCRITICAL: Your previous attempt returned "${trimmed}" which still contains Russian/Cyrillic words. This is WRONG. You MUST replace every non-${targetLang} word with its closest natural equivalent in ${targetLang}. The output must contain ZERO Cyrillic characters.`,
					},
				];
				const retryMessage = await complete(this.model, { messages: retryMessages as any[] }, options);
				let retryResult = "";
				for (const block of retryMessage.content) {
					if (block.type === "text") retryResult += block.text;
				}
				const retryTrimmed = retryResult.trim();
				console.log(`[Translator] Retry Output: "${retryTrimmed}"`);
				if (retryTrimmed && retryTrimmed.toUpperCase() !== "NO_RESPONSE") {
					trimmed = retryTrimmed;
				}
			}

			return { ok: true, text: trimmed };
		} catch (err) {
			console.error("[Translator] AI Error:", err);
			return { ok: false, reason: "error", error: err };
		}
	}
}
