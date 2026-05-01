import { describe, expect, it } from "vitest";
import type { ClubAgentContext } from "../src/core/types.js";
import { resolveClientSkillProposal } from "../src/skills/client-skill-proposals.js";

describe("client skill proposals", () => {
	it("creates an approved-action proposal for a selected booking skill", () => {
		const proposal = resolveClientSkillProposal({
			text: "Меня зовут Анна. Хочу записаться во вторник 16:30, телефон +972 50 123 4567",
			context: createContext("booking_consultation"),
			auditEventId: "audit_123",
			sessionId: "client_123",
			agentId: "firm_demo:client_agent",
		});

		expect(proposal?.proposal.skillId).toBe("booking_consultation");
		expect(proposal?.proposal.proposedActions).toEqual([
			{
				actionId: "update_lead_fields",
				reason: "client_requested_booking",
				payload: {
					identityPatch: {
						fullName: "Анна",
						phone: "+972501234567",
						preferredChannel: "whatsapp",
					},
					profilePatch: {
						activeStatus: "booking_confirmed",
						nextStep: "booking_confirmed:вторник 16:30",
						budgetLevel: "medium",
						paymentCapacity: "medium",
						motivationsJson: ["confirmed_booking_request"],
					},
					sourceType: "intake_answer",
					sourceRef: "linda_booking_confirmation",
				},
			},
		]);
	});

	it("does not create booking proposals for other selected skills", () => {
		const proposal = resolveClientSkillProposal({
			text: "Хочу записаться во вторник 16:30",
			context: createContext("manager"),
			auditEventId: "audit_123",
			sessionId: "client_123",
			agentId: "firm_demo:client_agent",
		});

		expect(proposal).toBeUndefined();
	});
});

function createContext(activeSkill: ClubAgentContext["activeSkill"]): ClubAgentContext {
	return {
		tenantId: "firm_demo",
		clientId: "client_123",
		channel: "web",
		relationshipState: "high_intent",
		conversationGoal: "book_consultation",
		activeSkill,
		allowedSkills: [activeSkill],
	};
}
