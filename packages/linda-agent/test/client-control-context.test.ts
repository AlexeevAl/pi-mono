import { describe, expect, it } from "vitest";
import { applyClientControlDecision } from "../src/core/client-control-context.js";
import type { ControlTurnDecision } from "../src/core/control-types.js";
import type { ClubAgentContext } from "../src/core/types.js";

describe("client control context", () => {
	it("applies active skill, allowed skills, skill context, and current step from control", () => {
		const result = applyClientControlDecision(createContext(), {
			activeSkillId: "booking_consultation",
			allowedSkillIds: ["booking_consultation", "human_handoff"],
			skillContext: { selectedBy: "scenario_engine" },
			session: {
				currentStep: "book_consultation",
			} as ControlTurnDecision["session"],
		});

		expect(result.activeSkill).toBe("booking_consultation");
		expect(result.allowedSkills).toEqual(["booking_consultation", "human_handoff"]);
		expect(result.conversationGoal).toBe("book_consultation");
		expect(result.skillContext).toEqual({ selectedBy: "scenario_engine" });
	});

	it("falls back when control returns an unsupported edge-local skill or step", () => {
		const result = applyClientControlDecision(createContext(), {
			activeSkillId: "unknown_skill",
			allowedSkillIds: ["unknown_skill"],
			skillContext: {},
			session: {
				currentStep: "unknown_step",
			} as ControlTurnDecision["session"],
		});

		expect(result.activeSkill).toBe("manager");
		expect(result.allowedSkills).toEqual(["manager"]);
		expect(result.conversationGoal).toBe("clarify_need");
	});
});

function createContext(): ClubAgentContext {
	return {
		tenantId: "firm_demo",
		clientId: "client_123",
		channel: "web",
		relationshipState: "new_client",
		conversationGoal: "clarify_need",
		activeSkill: "manager",
		allowedSkills: ["manager"],
	};
}
