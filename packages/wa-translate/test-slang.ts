import "dotenv/config";
import { TranslatorService } from "./src/translator.js";

const translator = new TranslatorService(
	process.env.PROVIDER || "openai",
	process.env.MODEL || "gpt-5.4-mini",
	async () => process.env.OPENAI_API_KEY,
);

interface Case {
	text: string;
	targetLang: string;
	// Regex that the output must NOT match (source-language leakage check)
	forbiddenScript: RegExp;
}

const cases: Case[] = [
	{ text: "Надо ещё подшаманить.", targetLang: "Hebrew", forbiddenScript: /[А-Яа-яЁё]/ },
	{ text: "Ты чё, серьёзно?", targetLang: "Hebrew", forbiddenScript: /[А-Яа-яЁё]/ },
	{ text: "Всё пучком.", targetLang: "Hebrew", forbiddenScript: /[А-Яа-яЁё]/ },
	{ text: "Он полный балбес.", targetLang: "Hebrew", forbiddenScript: /[А-Яа-яЁё]/ },
	{ text: "Замутим что-нибудь?", targetLang: "Hebrew", forbiddenScript: /[А-Яа-яЁё]/ },
	{ text: "Да ладно, не парься.", targetLang: "Hebrew", forbiddenScript: /[А-Яа-яЁё]/ },
	{ text: "Это полный отстой.", targetLang: "Hebrew", forbiddenScript: /[А-Яа-яЁё]/ },
	{ text: "Давай замутим встречу.", targetLang: "Hebrew", forbiddenScript: /[А-Яа-яЁё]/ },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const c of cases) {
	const result = await translator.translate(c.text, c.targetLang);
	const problems: string[] = [];
	const text = result.ok ? result.text : undefined;

	if (!result.ok) {
		problems.push(`translation failed: ${result.reason}`);
	} else {
		if (c.forbiddenScript.test(result.text)) {
			problems.push(`leaked source-language chars: ${result.text.match(c.forbiddenScript)?.[0]}`);
		}
		if (result.text.includes("/") && /[А-Яа-яЁё]/.test(result.text)) {
			problems.push("alternatives separated by / with Cyrillic");
		}
	}

	const status = problems.length === 0 ? "PASS" : "FAIL";
	console.log(`[${status}] ${c.text} → ${text ?? "(none)"}`);
	if (problems.length > 0) {
		for (const p of problems) console.log(`   └─ ${p}`);
		failed++;
		failures.push(`${c.text} → ${text ?? "(none)"}  [${problems.join("; ")}]`);
	} else {
		passed++;
	}
}

console.log(`\n${passed}/${cases.length} passed, ${failed} failed`);
if (failed > 0) {
	console.error("\nFailures:");
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
