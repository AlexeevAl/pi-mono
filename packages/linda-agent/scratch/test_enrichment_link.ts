import dotenv from "dotenv";
import { ClinicBackendClient } from "../src/core/backend-client.js";

dotenv.config();

async function test() {
  const firmId = process.env.FIRM_ID || "linda-clinic";
  const baseUrl = process.env.PSF_ENGINE_URL || "http://localhost:3050";
  const secret = process.env.FIRM_SHARED_SECRET || "psf_hermes_secret_123";

  console.log(`Connecting to ${baseUrl} (Firm: ${firmId})...`);

  const client = new ClinicBackendClient({
    baseUrl,
    firmId,
    sharedSecret: secret,
    edgeId: "test-script",
    locale: "ru",
    skillsDir: "./skills"
  });

  // Замените на реальный clientId из вашей базы (например, из логов или демо-данных)
  const clientId = "user_wa_79991234567"; 

  try {
    console.log(`Requesting enrichment link for ${clientId}...`);
    const result = await client.requestEnrichmentLink(clientId, { channel: "web" }, {
        mode: "intake",
        questions: ["name", "city"]
    });
    
    console.log("SUCCESS!");
    console.log("Token:", result.token);
    console.log("Link:", result.link);
    console.log("\nПопробуйте открыть эту ссылку в навигаторе, чтобы проверить UI.");
  } catch (err) {
    console.error("FAILED:", (err as Error).message);
    console.log("\nПодсказка: Проверьте, запущен ли psf-engine-v2 (npm run demo:web:dev)");
  }
}

test();
