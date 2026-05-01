import type { ControlTurnDecision } from "./control-types.js";
import type { ClientSkillId, ClubAgentContext, ClubConversationGoal } from "./types.js";

export function applyClientControlDecision(
	context: ClubAgentContext,
	control: Pick<ControlTurnDecision, "activeSkillId" | "allowedSkillIds" | "skillContext" | "session">,
): ClubAgentContext {
	const activeSkill = resolveControlSkillId(control.activeSkillId, context.activeSkill);
	return {
		...context,
		activeSkill,
		allowedSkills: resolveAllowedControlSkills(control.allowedSkillIds, context.allowedSkills),
		conversationGoal: resolveConversationGoal(control.session.currentStep, context.conversationGoal),
		skillContext: control.skillContext,
	};
}

function resolveAllowedControlSkills(controlSkillIds: string[], fallback: ClientSkillId[]) {
	const result = controlSkillIds
		.map((skillId) => resolveControlSkillId(skillId, undefined))
		.filter((skillId): skillId is ClientSkillId => Boolean(skillId));
	return result.length > 0 ? result : fallback;
}

function resolveControlSkillId(skillId: string, fallback: ClientSkillId | undefined): ClientSkillId {
	if (isClientSkillId(skillId)) {
		return skillId;
	}
	return fallback ?? "manager";
}

function resolveConversationGoal(value: string, fallback: ClubConversationGoal): ClubConversationGoal {
	if (isClientConversationGoal(value)) {
		return value;
	}
	return fallback;
}

function isClientSkillId(skillId: string): skillId is ClientSkillId {
	return [
		"problem_discovery",
		"profile_enrichment",
		"service_recommendation",
		"booking_consultation",
		"post_procedure_checkin",
		"reactivation",
		"membership_offer",
		"annual_plan_tracking",
		"objection_handling",
		"human_handoff",
		"manager",
		"none",
	].includes(skillId);
}

function isClientConversationGoal(value: string): value is ClubConversationGoal {
	return [
		"clarify_need",
		"complete_profile",
		"recommend_service",
		"track_annual_plan",
		"book_consultation",
		"post_treatment_checkin",
		"reactivate_client",
		"sell_membership",
		"handle_objection",
		"handoff_to_human",
	].includes(value);
}
