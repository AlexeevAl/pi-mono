import type { AgentTurnProposal, AuditEventId } from "../core/control-types.js";
import type { ClubAgentContext } from "../core/types.js";

export interface ClientSkillProposal {
	reply: string;
	proposal: AgentTurnProposal;
}

export function resolveClientSkillProposal(input: {
	text: string;
	context: ClubAgentContext;
	auditEventId: AuditEventId;
	sessionId: string;
	agentId: string;
}): ClientSkillProposal | undefined {
	if (input.context.activeSkill === "booking_consultation") {
		return resolveBookingConsultationProposal(input);
	}
	return undefined;
}

function resolveBookingConsultationProposal(input: {
	text: string;
	context: ClubAgentContext;
	auditEventId: AuditEventId;
	sessionId: string;
	agentId: string;
}): ClientSkillProposal | undefined {
	const bookingConfirmation = resolveBookingConfirmation(input.text);
	if (!bookingConfirmation) {
		return undefined;
	}

	const reply = buildBookingConfirmationReply(bookingConfirmation);
	return {
		reply,
		proposal: {
			auditEventId: input.auditEventId,
			sessionId: input.sessionId,
			agentId: input.agentId,
			skillId: input.context.activeSkill,
			clientMessage: reply,
			proposedActions: [
				{
					actionId: "update_lead_fields",
					reason: "client_requested_booking",
					payload: {
						identityPatch: bookingConfirmation.identityPatch,
						profilePatch: bookingConfirmation.profilePatch,
						sourceType: "intake_answer",
						sourceRef: "linda_booking_confirmation",
					},
				},
			],
			extractedFields: {
				fullName: bookingConfirmation.fullName,
				phone: bookingConfirmation.phone,
				appointmentWindow: bookingConfirmation.appointmentWindow,
			},
			confidence: 0.9,
		},
	};
}

function resolveBookingConfirmation(text: string) {
	const normalized = text.trim().toLowerCase();
	const hasBookingIntent =
		normalized.includes("подтверждаю запись") ||
		normalized.includes("хочу записаться") ||
		normalized.includes("запишите") ||
		normalized.includes("записаться");
	const hasSlot =
		/\b\d{1,2}[:.]\d{2}\b/.test(normalized) ||
		/(понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресенье)/i.test(normalized);
	if (!hasBookingIntent || !hasSlot) {
		return undefined;
	}

	const fullName = extractName(text);
	const phone = extractPhone(text);
	const budgetLevel = normalized.includes("средн") ? "medium" : undefined;
	const appointmentWindow = extractAppointmentWindow(text);
	const nextStep = appointmentWindow ? `booking_confirmed:${appointmentWindow}` : "booking_confirmed";

	return {
		fullName,
		phone,
		appointmentWindow,
		identityPatch: {
			...(fullName ? { fullName } : {}),
			...(phone ? { phone } : {}),
			preferredChannel: "whatsapp",
		},
		profilePatch: {
			activeStatus: "booking_confirmed",
			nextStep,
			budgetLevel: budgetLevel ?? "medium",
			paymentCapacity: budgetLevel ?? "medium",
			motivationsJson: ["confirmed_booking_request"],
		},
	};
}

function extractName(text: string) {
	const match = /(?:имя|меня зовут)\s*[:-]?\s*([А-ЯA-ZЁ][А-ЯA-ZЁа-яa-zё\- ]{1,60})/iu.exec(text);
	return match?.[1]
		?.trim()
		.replace(/[.,;].*$/, "")
		.trim();
}

function extractPhone(text: string) {
	const match = /(?:\+?\d[\d\s().-]{7,}\d)/.exec(text);
	return match?.[0]?.replace(/[^\d+]/g, "");
}

function extractAppointmentWindow(text: string) {
	const dayMatch = /(понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)/i.exec(text);
	const timeMatch = /\b(\d{1,2}[:.]\d{2})\b/.exec(text);
	const day = dayMatch?.[1]?.toLowerCase();
	const time = timeMatch?.[1]?.replace(".", ":");
	const displayDay = day ? normalizeAppointmentDay(day) : undefined;
	if (displayDay && time) return `${displayDay} ${time}`;
	return time ?? displayDay;
}

function buildBookingConfirmationReply(input: { fullName?: string; phone?: string; appointmentWindow?: string }) {
	const nameLine = input.fullName ? `, ${input.fullName}` : "";
	const slot = input.appointmentWindow ?? "выбранный слот";
	const contact = input.phone ? ` Контакт для подтверждения: ${input.phone}.` : "";
	return `Готово${nameLine}: я зафиксировала запрос на запись на ${slot} в центральной локации.${contact}

До визита подготовьте список домашнего ухода, даты недавних процедур/пилингов и не используйте ретинол, кислоты или агрессивные скрабы за день до консультации. Администратор/врач увидит ваш профиль: чувствительная кожа, цель — мягкое улучшение тона и снижение покраснений, старт — консультация плюс одна щадящая процедура.`;
}

function normalizeAppointmentDay(day: string) {
	const normalized = day.toLowerCase();
	const byDay: Record<string, string> = {
		понедельник: "понедельник",
		вторник: "вторник",
		среда: "среду",
		среду: "среду",
		четверг: "четверг",
		пятница: "пятницу",
		пятницу: "пятницу",
		суббота: "субботу",
		субботу: "субботу",
		воскресенье: "воскресенье",
	};
	return byDay[normalized] ?? normalized;
}
