import { defineAgent, voice } from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as openai from "@livekit/agents-plugin-openai";
import * as silero from "@livekit/agents-plugin-silero";
import { LindaClientAgent } from "../../agents/LindaClientAgent.js";
import { buildRuntimeConfig } from "../../config.js";
import { LindaLLM } from "./LindaLLM.js";

export default defineAgent({
	prewarm: async (proc) => {
		proc.userData.vad = await silero.VAD.load();
	},
	entry: async (ctx) => {
		const config = buildRuntimeConfig();
		const clientAgent = new LindaClientAgent(config);

		console.log(`[LiveKit Agent] Starting job ${ctx.job.id} in room ${ctx.room.name}`);

		await ctx.connect();
		console.log(`[LiveKit Agent] Connected to room`);

		const lindaLlm = new LindaLLM(clientAgent, "livekit-user");
		const agent = new voice.Agent({
			instructions:
				"Ты — Линда, профессиональный ассистент стоматологической клиники. Твоя задача — помогать врачам и администраторам с управлением клиникой, записью пациентов и ответами на вопросы. Говори вежливо, профессионально и только на русском языке.",
			llm: lindaLlm,
		});

		console.log("[LiveKit Agent] Initializing STT/TTS/LLM...");
		const session = new voice.AgentSession({
			vad: ctx.proc.userData.vad! as silero.VAD,
			stt: new deepgram.STT({ model: "nova-3", language: "ru" }),
			tts: new openai.TTS({ model: "gpt-4o-mini-tts", voice: "nova" }),
			llm: lindaLlm,
			useTtsAlignedTranscript: true,
			turnHandling: {
				interruption: {
					enabled: true,
					minDuration: 500,
					minWords: 2,
				},
			},
		});

		console.log("[LiveKit Agent] Starting session...");
		await session.start({
			agent,
			room: ctx.room,
		});

		console.log("[LiveKit Agent] Session started, saying hello...");
		session.say("Здравствуйте! Я Линда, ваш виртуальный ассистент. Чем я могу вам помочь?");
		console.log("[LiveKit Agent] Session ready");
	},
});
