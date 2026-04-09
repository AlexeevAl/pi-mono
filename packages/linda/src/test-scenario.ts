import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { PsfClient } from "./psf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

async function runTest() {
	const psf = new PsfClient({
		baseUrl: process.env.PSF_BASE_URL || "http://localhost:3033",
		sharedSecret: process.env.PSF_SHARED_SECRET || "psf_hermes_secret_123",
	});

	const userId = "test_user_" + Date.now();
	const channel = "whatsapp";

	console.log("🚀 Starting Scenario Test: relocation_v1");
	console.log("----------------------------------------");

	// 1. Initial State
	console.log("\n[Step 1] Initializing session with packId: relocation_v1");
	const turn1 = await psf.postTurn({
		requestId: "req_1",
		userId,
		channel,
		userText: "Я хочу переехать",
		packId: "relocation_v1",
		extractedPayload: {},
	});

	if (turn1.status === "active") {
		console.log(`Current Step: ${turn1.step.id}`);
		console.log(`Bot Question: ${turn1.step.uiHints?.suggestedPrompt}`);

		if (turn1.step.id !== "capture_contact") {
			console.error("❌ Expected capture_contact, but got " + turn1.step.id);
		} else {
			console.log("✅ Correctly started at capture_contact");
		}
	}

	// 2. Submit Contact
	console.log("\n[Step 2] Submitting contact data...");
	const turn2 = await psf.postTurn({
		requestId: "req_2",
		userId,
		channel,
		userText: "Меня зовут Иван, телефон +79111234567",
		extractedPayload: {
			clientName: "Иван",
			clientPhone: "+79111234567",
			clientEmail: "ivan@example.com",
		},
	});

	if (turn2.status === "active") {
		console.log(`Current Step: ${turn2.step.id}`);
		console.log(`Bot Question: ${turn2.step.uiHints?.suggestedPrompt}`);

		if (turn2.step.id !== "capture_situation") {
			console.error("❌ Expected capture_situation, but got " + turn2.step.id);
		} else {
			console.log("✅ Correctly moved to capture_situation");
		}
	}

	// 3. Submit Situation
	console.log("\n[Step 3] Submitting situation (destination)...");
	const turn3 = await psf.postTurn({
		requestId: "req_3",
		userId,
		channel,
		userText: "Хочу в Германию через полгода",
		extractedPayload: {
			targetCountry: "Германия",
			moveTimeline: "через 6 месяцев",
			householdComposition: "один",
		},
	});

	if (turn3.status === "active") {
		console.log(`Current Step: ${turn3.step.id}`);
		console.log(`Bot Question: ${turn3.step.uiHints?.suggestedPrompt}`);

		if (turn3.step.id !== "capture_tax_profile") {
			console.error("❌ Expected capture_tax_profile, but got " + turn3.step.id);
		} else {
			console.log("✅ Correctly moved to capture_tax_profile");
		}
	}

	console.log("\n----------------------------------------");
	console.log("🏁 Test Completed Successfully!");
}

runTest().catch((err) => {
	console.error("💥 Test Failed:", err);
	process.exit(1);
});
