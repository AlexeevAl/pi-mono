import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRuntimeConfig } from "../src/config.js";
import { applyClientControlDecision } from "../src/core/client-control-context.js";
import type { ControlTurnDecision } from "../src/core/control-types.js";
import type { ClubAgentContext } from "../src/core/types.js";

describe("Medora Competitor Skills Integration Test Suite", () => {
	it("should load new skills enabled by default in runtime configuration", () => {
		const config = buildRuntimeConfig();
		const enabled = config.clientAgent.enabledSkills;

		expect(enabled).toContain("clinical_triage");
		expect(enabled).toContain("missed_call_triage");
		expect(enabled).toContain("post_procedure_checkin");
		expect(enabled).toContain("reactivation");
	});

	it("should verify all 4 Medora skill files exist and are populated with correct canonical SKILL.md schemas", () => {
		const skills = ["clinical_triage", "missed_call_triage", "post_procedure_checkin", "reactivation"];

		for (const skill of skills) {
			const skillPath = path.join(__dirname, "..", "skills", skill, "SKILL.md");
			expect(fs.existsSync(skillPath)).toBe(true);

			const content = fs.readFileSync(skillPath, "utf-8");
			expect(content).toContain(`Skill: `);
			expect(content).toContain("Главная задача");
			expect(content).toContain("Жёсткие правила");
		}
	});

	it("should correctly map clinical_triage skill from control turn decision without falling back to manager", () => {
		const context: ClubAgentContext = {
			tenantId: "medora",
			clientId: "client_medora_123",
			channel: "whatsapp",
			relationshipState: "new_client",
			conversationGoal: "clarify_need",
			activeSkill: "manager",
			allowedSkills: ["manager"],
		};

		const result = applyClientControlDecision(context, {
			activeSkillId: "clinical_triage",
			allowedSkillIds: ["clinical_triage", "human_handoff"],
			skillContext: { triageRequired: true },
			session: {
				currentStep: "complete_profile",
			} as ControlTurnDecision["session"],
		});

		expect(result.activeSkill).toBe("clinical_triage");
		expect(result.allowedSkills).toEqual(["clinical_triage", "human_handoff"]);
		expect(result.conversationGoal).toBe("complete_profile");
		expect(result.skillContext).toEqual({ triageRequired: true });
	});

	it("should correctly map missed_call_triage skill from control turn decision without falling back to manager", () => {
		const context: ClubAgentContext = {
			tenantId: "medora",
			clientId: "client_medora_123",
			channel: "whatsapp",
			relationshipState: "new_client",
			conversationGoal: "clarify_need",
			activeSkill: "manager",
			allowedSkills: ["manager"],
		};

		const result = applyClientControlDecision(context, {
			activeSkillId: "missed_call_triage",
			allowedSkillIds: ["missed_call_triage", "human_handoff"],
			skillContext: { missedCallReceivedAt: "2026-05-24T15:00:00Z" },
			session: {
				currentStep: "clarify_need",
			} as ControlTurnDecision["session"],
		});

		expect(result.activeSkill).toBe("missed_call_triage");
		expect(result.allowedSkills).toEqual(["missed_call_triage", "human_handoff"]);
		expect(result.conversationGoal).toBe("clarify_need");
		expect(result.skillContext).toEqual({ missedCallReceivedAt: "2026-05-24T15:00:00Z" });
	});

	it("should correctly map post_procedure_checkin skill from control turn decision without falling back to manager", () => {
		const context: ClubAgentContext = {
			tenantId: "medora",
			clientId: "client_medora_123",
			channel: "whatsapp",
			relationshipState: "post_procedure",
			conversationGoal: "post_treatment_checkin",
			activeSkill: "manager",
			allowedSkills: ["manager"],
		};

		const result = applyClientControlDecision(context, {
			activeSkillId: "post_procedure_checkin",
			allowedSkillIds: ["post_procedure_checkin", "human_handoff"],
			skillContext: { lastVisitDate: "2026-05-23" },
			session: {
				currentStep: "post_treatment_checkin",
			} as ControlTurnDecision["session"],
		});

		expect(result.activeSkill).toBe("post_procedure_checkin");
		expect(result.allowedSkills).toEqual(["post_procedure_checkin", "human_handoff"]);
		expect(result.conversationGoal).toBe("post_treatment_checkin");
	});

	it("should correctly map reactivation skill from control turn decision without falling back to manager", () => {
		const context: ClubAgentContext = {
			tenantId: "medora",
			clientId: "client_medora_123",
			channel: "whatsapp",
			relationshipState: "reactivation_candidate",
			conversationGoal: "reactivate_client",
			activeSkill: "manager",
			allowedSkills: ["manager"],
		};

		const result = applyClientControlDecision(context, {
			activeSkillId: "reactivation",
			allowedSkillIds: ["reactivation", "human_handoff"],
			skillContext: { lastVisitDate: "2025-11-24" },
			session: {
				currentStep: "reactivate_client",
			} as ControlTurnDecision["session"],
		});

		expect(result.activeSkill).toBe("reactivation");
		expect(result.allowedSkills).toEqual(["reactivation", "human_handoff"]);
		expect(result.conversationGoal).toBe("reactivate_client");
	});
});
