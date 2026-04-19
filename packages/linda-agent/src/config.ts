import fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import type { LindaRuntimeConfig } from "./core/types.js";

// Load .env if present (local dev)
if (fs.existsSync(".env")) {
	loadDotenv();
}

/**
 * Builds a LindaRuntimeConfig from environment variables.
 * Used for both local development and production deployments.
 */
export function buildRuntimeConfig(skillsDir?: string): LindaRuntimeConfig {
	const defaultSkillsDir = skillsDir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");

	return {
		backend: {
			baseUrl: process.env.PSF_ENGINE_URL ?? "http://localhost:3050",
			sharedSecret: process.env.FIRM_SHARED_SECRET ?? process.env.BRIDGE_SHARED_SECRET ?? "psf_hermes_secret_123",
			edgeId: process.env.EDGE_ID ?? "linda-local-edge",
			firmId: process.env.FIRM_ID ?? "linda-clinic",
		},
		llm: {
			provider: process.env.LLM_PROVIDER ?? "anthropic",
			model: process.env.LLM_MODEL ?? "claude-3-5-sonnet-20241022",
		},
		shared: {
			firmId: process.env.FIRM_ID ?? "linda-clinic",
			locale: process.env.LOCALE ?? "ru",
			skillsDir: defaultSkillsDir,
		},
		clientAgent: {
			enabledSkills: [
				"problem_discovery",
				"profile_enrichment",
				"service_recommendation",
				"annual_plan_tracking",
				"manager",
				"booking_consultation",
				"objection_handling",
				"human_handoff",
			],
			defaults: {
				channel: "whatsapp",
			},
		},
		adminAgent: {
			enabledSkills: ["admin_assistant"],
			allowedAdminIds: (process.env.ALLOWED_ADMIN_IDS ?? "")
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean),
			defaults: {
				channel: "telegram",
			},
		},
	};
}

// Legacy compat — kept for any code still calling getBackendConfig()
/** @deprecated Use buildRuntimeConfig() instead */
export function getBackendConfig() {
	return buildRuntimeConfig().backend;
}
