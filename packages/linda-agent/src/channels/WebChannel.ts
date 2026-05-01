import { createServer, type IncomingMessage as NodeRequest, type ServerResponse } from "node:http";
import type { LindaAdminAgent } from "../agents/LindaAdminAgent.js";
import type { LindaClientAgent } from "../agents/LindaClientAgent.js";
import { type ClientConversationMessage, ClinicBackendClient } from "../core/backend-client.js";
import type { AgentDecision, BackendConfig, ClubAgentContext } from "../core/types.js";

export interface WebChannelConfig {
	port: number;
	role: "client" | "admin";
	allowedOrigins?: string;
	firmName?: string;
	defaultActorId?: string;
	backend?: BackendConfig;
}

interface WebChatRequest {
	actorId?: string;
	text?: string;
	targetClientId?: string;
}

interface WebChatResponse {
	replies: Array<{ text: string }>;
	context?: ClubAgentContext;
}

export class WebChannel {
	private server: ReturnType<typeof createServer> | null = null;
	private readonly backend?: ClinicBackendClient;

	constructor(
		private readonly config: WebChannelConfig,
		private readonly agents: {
			clientAgent?: LindaClientAgent;
			adminAgent?: LindaAdminAgent;
		},
	) {
		this.backend = config.backend ? new ClinicBackendClient(config.backend) : undefined;
	}

	async start(): Promise<void> {
		this.server = createServer((req, res) => {
			void this.handleRequest(req, res).catch((error) => {
				console.error("[Web] Request error:", error);
				if (!res.headersSent) {
					this.json(res, 500, { error: "internal_error" });
				}
			});
		});

		await new Promise<void>((resolve, reject) => {
			this.server?.listen(this.config.port, () => resolve());
			this.server?.once("error", reject);
		});

		console.log(`[Web] ${this.config.role} channel listening on http://localhost:${this.config.port}`);
	}

	stop(): void {
		this.server?.close();
		this.server = null;
		console.log("[Web] Channel stopped");
	}

	private async handleRequest(req: NodeRequest, res: ServerResponse): Promise<void> {
		console.log(`[Web] ${req.method} ${req.url}`);
		this.applyCors(req, res);

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = new URL(req.url ?? "/", `http://localhost:${this.config.port}`);

		if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/chat")) {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(buildChatHtml(this.config));
			return;
		}

		if (req.method === "GET" && url.pathname === "/health") {
			this.json(res, 200, { ok: true, role: this.config.role });
			return;
		}

		if (req.method === "POST" && url.pathname === "/chat") {
			await this.handleChat(req, res);
			return;
		}

		if (req.method === "GET" && url.pathname === "/history") {
			await this.handleHistory(url, res);
			return;
		}

		if (req.method === "POST" && url.pathname === "/reset") {
			this.json(res, 200, { ok: true, resetStrategy: "client_side_actor_rotation" });
			return;
		}

		this.json(res, 404, { error: "not_found" });
	}

	private applyCors(req: NodeRequest, res: ServerResponse): void {
		const origin = req.headers.origin ?? "*";
		const allowed = this.config.allowedOrigins ?? "*";
		const corsOrigin =
			allowed === "*"
				? "*"
				: allowed
							.split(",")
							.map((item) => item.trim())
							.includes(origin)
					? origin
					: "null";

		res.setHeader("Access-Control-Allow-Origin", corsOrigin);
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");
	}

	private async handleChat(req: NodeRequest, res: ServerResponse): Promise<void> {
		console.log(`[Web] Reading JSON body...`);
		const body = await readJson<WebChatRequest>(req);
		console.log(`[Web] Body received:`, body);
		const text = String(body.text ?? "").trim();

		if (!text) {
			this.json(res, 400, {
				error: "missing_fields",
				message: "text is required",
			});
			return;
		}

		const actorId = this.resolveActorId(body.actorId);
		const clientId = this.resolvePersistedClientId(actorId, body.targetClientId);
		const result =
			this.config.role === "admin"
				? await this.runAdmin(actorId, text, body.targetClientId)
				: await this.runClient(actorId, text);
		await this.recordWebMessage(clientId, {
			direction: "inbound",
			senderType: this.config.role === "admin" ? "admin" : "client",
			messageType: "web_chat",
			text,
		});
		if (result.reply) {
			await this.recordWebMessage(clientId, {
				direction: "outbound",
				senderType: this.config.role === "admin" ? "admin" : "agent",
				messageType: "web_chat_reply",
				text: result.reply,
			});
		}

		const response: WebChatResponse = {
			replies: result.reply ? [{ text: result.reply }] : [],
			context: result.context,
		};

		this.json(res, 200, response);
	}

	private async handleHistory(url: URL, res: ServerResponse): Promise<void> {
		if (!this.backend) {
			this.json(res, 200, { messages: [] });
			return;
		}
		const actorId = this.resolveActorId(url.searchParams.get("actorId") ?? undefined);
		const targetClientId = url.searchParams.get("targetClientId") ?? undefined;
		const historyView = url.searchParams.get("view") ?? "chat";
		if (this.config.role === "admin" && !targetClientId?.trim()) {
			this.json(res, 200, { messages: [] });
			return;
		}
		const clientId = this.resolvePersistedClientId(actorId, targetClientId);
		let messages: ClientConversationMessage[];
		try {
			messages = await this.backend.listClientMessages(
				clientId,
				{
					role: this.config.role === "admin" ? "admin_agent" : "client_agent",
					channel: "web",
				},
				{ limit: 50 },
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes("listMessages failed: 404")) {
				this.json(res, 200, { clientId, messages: [] });
				return;
			}
			throw error;
		}
		this.json(res, 200, { clientId, messages: this.filterHistoryForRole(messages, historyView) });
	}

	private filterHistoryForRole(messages: ClientConversationMessage[], view: string): ClientConversationMessage[] {
		if (this.config.role === "admin") {
			if (view === "patient") {
				return messages.filter((message) => {
					if (message.senderType === "system") {
						return false;
					}
					if (message.senderType === "admin") {
						return this.isClientVisibleAdminMessage(message.messageType);
					}
					return true;
				});
			}
			return messages.filter(
				(message) => message.senderType === "admin" && (message.messageType ?? "").startsWith("web_chat"),
			);
		}
		return messages.filter((message) => {
			if (message.senderType === "system") {
				return false;
			}
			if (message.senderType === "admin") {
				return this.isClientVisibleAdminMessage(message.messageType);
			}
			return true;
		});
	}

	private isClientVisibleAdminMessage(messageType?: string): boolean {
		return ["booking_approved", "manual_message", "delivery_retry"].includes(messageType ?? "");
	}

	private async runClient(actorId: string, text: string): Promise<AgentDecision> {
		if (!this.agents.clientAgent) {
			throw new Error("client agent is not configured for web channel");
		}

		return await this.agents.clientAgent.decide({
			clientId: actorId,
			text,
			channel: "web",
		});
	}

	private async runAdmin(actorId: string, text: string, targetClientId?: string): Promise<AgentDecision> {
		if (!this.agents.adminAgent) {
			throw new Error("admin agent is not configured for web channel");
		}

		return await this.agents.adminAgent.decide({
			adminId: actorId,
			text,
			targetClientId: targetClientId?.trim() || undefined,
			channel: "web",
		});
	}

	private resolveActorId(rawActorId?: string): string {
		const trimmed = rawActorId?.trim();
		if (trimmed) {
			return trimmed.slice(0, 128);
		}

		if (this.config.defaultActorId) {
			return this.config.defaultActorId.slice(0, 128);
		}

		const prefix = this.config.role === "admin" ? "admin_web_" : "user_web_";
		return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
	}

	private resolvePersistedClientId(actorId: string, targetClientId?: string): string {
		if (this.config.role === "admin") {
			return targetClientId?.trim().slice(0, 128) || actorId;
		}
		return actorId;
	}

	private async recordWebMessage(
		clientId: string,
		message: Pick<ClientConversationMessage, "direction" | "text"> & {
			senderType: "client" | "agent" | "admin" | "system";
			messageType: string;
		},
	): Promise<void> {
		if (!this.backend || !message.text?.trim()) {
			return;
		}
		try {
			await this.backend.recordClientMessage(
				clientId,
				{
					direction: message.direction,
					senderType: message.senderType,
					messageType: message.messageType,
					text: message.text,
				},
				{
					role: this.config.role === "admin" ? "admin_agent" : "client_agent",
					channel: "web",
				},
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`[Web] Message persistence skipped: ${message}`);
		}
	}

	private json(res: ServerResponse, statusCode: number, payload: unknown): void {
		res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(payload));
	}
}

async function readJson<T>(req: NodeRequest): Promise<Partial<T>> {
	return await new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(data || "{}") as T);
			} catch {
				resolve({} as T);
			}
		});
		req.on("error", reject);
	});
}

function buildChatHtml(config: WebChannelConfig): string {
	const roleLabel = config.role === "admin" ? "Linda Admin Console" : "Linda Web Chat";
	const title = config.firmName ? `${config.firmName} — ${roleLabel}` : roleLabel;
	const defaultActorId = config.defaultActorId ?? "";
	const role = config.role;

	return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<style>
  :root {
    --bg: #f4ead9;
    --ink: #1d1813;
    --muted: #6d6256;
    --panel: rgba(255,251,244,0.92);
    --line: rgba(49,31,17,0.12);
    --accent: #1d5b49;
    --accent-2: #b0603e;
    --shadow: 0 24px 80px rgba(36,22,12,0.12);
    --user-bubble: rgba(29,91,73,0.12);
    --bot-bubble: rgba(255,255,255,0.82);
    --field-bg: rgba(255,255,255,0.74);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: Georgia, "Times New Roman", serif;
    color: var(--ink);
    background:
      radial-gradient(circle at top left, rgba(176,96,62,0.16), transparent 28%),
      radial-gradient(circle at top right, rgba(29,91,73,0.15), transparent 24%),
      linear-gradient(180deg, #f8efe0 0%, #f3e6d2 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px 16px 0;
  }
  .header {
    width: 100%;
    max-width: 720px;
    padding: 0 4px 16px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .headerCopy {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .header h1 { font-size: 1.5rem; line-height: 1; letter-spacing: -0.02em; }
  .header p  { font-size: 0.88rem; color: var(--muted); }
  .metaPill {
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 0.78rem;
    color: var(--muted);
    background: rgba(255,255,255,0.55);
  }
  .chatWrap {
    width: 100%;
    max-width: 720px;
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 28px 28px 0 0;
    box-shadow: var(--shadow);
    backdrop-filter: blur(18px);
    overflow: hidden;
    min-height: 0;
    position: relative;
  }
  .toolbar {
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
    background: rgba(255,251,244,0.7);
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .fieldLabel {
    font-size: 0.76rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .field input {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 10px 12px;
    font: inherit;
    background: var(--field-bg);
    color: var(--ink);
    outline: none;
  }
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px 20px 8px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    scroll-behavior: smooth;
  }
  .msg { max-width: 84%; display: flex; flex-direction: column; gap: 4px; }
  .msg.user { align-self: flex-end; align-items: flex-end; }
  .msg.bot  { align-self: flex-start; align-items: flex-start; }
  .msg.internal { align-self: center; align-items: stretch; max-width: 92%; width: 92%; }
  .bubble {
    padding: 10px 16px;
    border-radius: 18px;
    font-size: 0.97rem;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .bubble a {
    color: var(--accent);
    text-decoration: underline;
    font-weight: 500;
  }
  .msg.user .bubble {
    background: var(--user-bubble);
    border-bottom-right-radius: 4px;
  }
  .msg.bot .bubble {
    background: var(--bot-bubble);
    border: 1px solid var(--line);
    border-bottom-left-radius: 4px;
  }
  .msg.internal .bubble {
    background: rgba(109,98,86,0.08);
    border: 1px dashed rgba(109,98,86,0.38);
    color: var(--muted);
    border-radius: 10px;
    font-size: 0.86rem;
  }
  .msg.internal .bubble::before {
    content: "internal admin";
    display: block;
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-bottom: 4px;
    color: rgba(109,98,86,0.78);
  }
  .typing {
    align-self: flex-start;
    display: flex;
    gap: 5px;
    padding: 12px 16px;
    background: var(--bot-bubble);
    border: 1px solid var(--line);
    border-radius: 18px 18px 18px 4px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--muted);
    animation: blink 1.2s infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink {
    0%, 80%, 100% { opacity: 0.3; }
    40% { opacity: 1; }
  }
  .inputRow {
    display: flex;
    gap: 10px;
    padding: 14px 16px;
    border-top: 1px solid var(--line);
    background: rgba(255,251,244,0.6);
    backdrop-filter: blur(8px);
  }
  .inputRow textarea {
    flex: 1;
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 10px 14px;
    font: inherit;
    font-size: 0.97rem;
    background: rgba(255,255,255,0.8);
    color: var(--ink);
    resize: none;
    outline: none;
    min-height: 44px;
    max-height: 140px;
    overflow-y: auto;
    line-height: 1.4;
  }
  .sendBtn {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: none;
    background: var(--ink);
    color: #fff8ef;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    align-self: flex-end;
  }
  .sendBtn:disabled { opacity: 0.35; cursor: not-allowed; }
  .resetBtn {
    position: absolute;
    top: 16px;
    right: 16px;
    font-size: 0.78rem;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    padding: 4px 8px;
    border-radius: 999px;
  }
  .errorLine {
    color: #8b3d2f;
    font-size: 0.84rem;
    padding: 0 16px 12px;
  }
  .patientPanel {
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    background: rgba(255,251,244,0.66);
    padding: 12px 16px;
  }
  .patientPanel[hidden] { display: none; }
  .patientPanelHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }
  .patientPanel.isCollapsed .patientPanelHeader {
    margin-bottom: 0;
  }
  .patientPanelTitle {
    font-size: 0.9rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .patientHistoryBtn {
    border: 1px solid var(--line);
    border-radius: 999px;
    background: rgba(255,255,255,0.7);
    color: var(--ink);
    cursor: pointer;
    font: inherit;
    font-size: 0.82rem;
    padding: 6px 12px;
  }
  .patientPanelActions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .patientMessages {
    max-height: 220px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .patientMsg {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgba(255,255,255,0.64);
    padding: 8px 10px;
  }
  .patientMsgMeta {
    color: var(--muted);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: 3px;
  }
  .patientMsgText {
    font-size: 0.88rem;
    line-height: 1.42;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .patientPanelEmpty {
    color: var(--muted);
    font-size: 0.84rem;
  }
  .patientPanel.isCollapsed .patientMessages {
    display: none;
  }
  @media (max-width: 640px) {
    .toolbar { grid-template-columns: 1fr; }
    .header { align-items: flex-start; flex-direction: column; }
    .msg { max-width: 92%; }
  }
</style>
</head>
<body>
<div class="header">
  <div class="headerCopy">
    <h1>${escHtml(config.firmName ?? "Linda")}</h1>
    <p>${role === "admin" ? "Web admin shell" : "Web client shell"} powered by canonical linda-agent</p>
  </div>
  <div class="metaPill">${escHtml(role)}</div>
</div>

<div class="chatWrap">
  <button class="resetBtn" onclick="resetChat()" title="Сбросить локальную сессию">↺ reset</button>
  <div class="toolbar">
    <label class="field">
      <span class="fieldLabel">${role === "admin" ? "Admin ID" : "Client ID"}</span>
      <input id="actorId" placeholder="${role === "admin" ? "admin_web_demo" : "user_web_demo"}" />
    </label>
    <label class="field" id="targetField" style="${role === "admin" ? "" : "display:none;"}">
      <span class="fieldLabel">Target Client ID</span>
      <input id="targetClientId" placeholder="user_web_abc12345" />
    </label>
  </div>
  <div class="patientPanel" id="patientPanel" ${role === "admin" ? "" : "hidden"}>
    <div class="patientPanelHeader">
      <div class="patientPanelTitle">История пациента</div>
      <div class="patientPanelActions">
        <button class="patientHistoryBtn" type="button" onclick="togglePatientHistory()" id="patientToggleBtn">Свернуть</button>
        <button class="patientHistoryBtn" type="button" onclick="loadPatientHistory()">Обновить</button>
      </div>
    </div>
    <div class="patientMessages" id="patientMessages">
      <div class="patientPanelEmpty">Выберите Target Client ID, чтобы посмотреть историю пациента.</div>
    </div>
  </div>
  <div class="messages" id="messages"></div>
  <div id="errorLine" class="errorLine" hidden></div>
  <div class="inputRow">
    <textarea id="input" placeholder="Напишите сообщение…" rows="1" onkeydown="onKey(event)" oninput="autoResize(this)"></textarea>
    <button class="sendBtn" id="sendBtn" onclick="sendMessage()" title="Отправить">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>
    </button>
  </div>
</div>

<script>
const ROLE = ${JSON.stringify(role)};
const DEFAULT_ACTOR_ID = ${JSON.stringify(defaultActorId)};
const STORAGE_KEY = ROLE === 'admin' ? 'linda:web:admin:id' : 'linda:web:client:id';
const PATIENT_HISTORY_COLLAPSED_KEY = 'linda:web:admin:patient-history:collapsed';
let loading = false;

function generateActorId() {
  const prefix = ROLE === 'admin' ? 'admin_web_' : 'user_web_';
  return prefix + Math.random().toString(36).slice(2, 10);
}

function getActorId() {
  const input = document.getElementById('actorId');
  return input.value.trim();
}

function setActorId(nextId) {
  const input = document.getElementById('actorId');
  input.value = nextId;
  localStorage.setItem(STORAGE_KEY, nextId);
}

function ensureActorId() {
  const stored = localStorage.getItem(STORAGE_KEY);
  const actorId = stored || DEFAULT_ACTOR_ID || generateActorId();
  setActorId(actorId);
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function scrollDown() {
  const el = document.getElementById('messages');
  el.scrollTop = el.scrollHeight;
}

function setError(message) {
  const el = document.getElementById('errorLine');
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function addMsg(role, text) {
  const msgs = document.getElementById('messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  
  let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  html = html.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
  html = html.replace(/(https?:\\/\\/[^\\s<*]+)/g, '<a href=\\"$1\\" target=\\"_blank\\" rel=\\"noopener noreferrer\\">$1</a>');
  
  bubble.innerHTML = html;
  wrap.appendChild(bubble);

  msgs.appendChild(wrap);
  scrollDown();
}

function clearMessages() {
  document.getElementById('messages').innerHTML = '';
}

function clearPatientHistory(message) {
  const el = document.getElementById('patientMessages');
  if (!el) return;
  el.innerHTML = '';
  if (message) {
    const empty = document.createElement('div');
    empty.className = 'patientPanelEmpty';
    empty.textContent = message;
    el.appendChild(empty);
  }
}

function isPatientHistoryCollapsed() {
  return localStorage.getItem(PATIENT_HISTORY_COLLAPSED_KEY) === 'true';
}

function applyPatientHistoryCollapsedState() {
  const panel = document.getElementById('patientPanel');
  const button = document.getElementById('patientToggleBtn');
  if (!panel || !button) return;
  const collapsed = isPatientHistoryCollapsed();
  panel.classList.toggle('isCollapsed', collapsed);
  button.textContent = collapsed ? 'Показать' : 'Свернуть';
}

function togglePatientHistory() {
  localStorage.setItem(PATIENT_HISTORY_COLLAPSED_KEY, String(!isPatientHistoryCollapsed()));
  applyPatientHistoryCollapsedState();
}

function addPatientMsg(message) {
  const el = document.getElementById('patientMessages');
  if (!el || !message || typeof message.text !== 'string' || !message.text.trim()) return;
  const item = document.createElement('div');
  item.className = 'patientMsg';
  const meta = document.createElement('div');
  meta.className = 'patientMsgMeta';
  meta.textContent = formatPatientMeta(message);
  const text = document.createElement('div');
  text.className = 'patientMsgText';
  text.textContent = message.text;
  item.appendChild(meta);
  item.appendChild(text);
  el.appendChild(item);
}

function formatPatientMeta(message) {
  const senderType = typeof message.senderType === 'string' ? message.senderType : 'message';
  const messageType = typeof message.messageType === 'string' ? message.messageType : '';
  if (senderType === 'client') return 'client';
  if (senderType === 'agent') return 'agent';
  if (senderType === 'admin' && messageType === 'booking_approved') return 'admin notification';
  if (senderType === 'admin') return 'admin';
  return senderType;
}

function renderPatientHistory(messages) {
  clearPatientHistory('');
  if (!Array.isArray(messages) || messages.length === 0) {
    clearPatientHistory('История пациента пустая.');
    return;
  }
  let rendered = 0;
  for (const message of messages) {
    if (!message || typeof message.text !== 'string' || !message.text.trim()) continue;
    const senderType = typeof message.senderType === 'string' ? message.senderType : '';
    const messageType = typeof message.messageType === 'string' ? message.messageType : '';
    if (senderType === 'system') continue;
    if (senderType === 'admin' && !['booking_approved', 'manual_message', 'delivery_retry'].includes(messageType)) continue;
    addPatientMsg(message);
    rendered += 1;
  }
  if (rendered === 0) {
    clearPatientHistory('История пациента пустая.');
  }
}

function renderHistory(messages) {
  clearMessages();
  if (!Array.isArray(messages)) return;
  for (const message of messages) {
    if (!message || typeof message.text !== 'string' || !message.text.trim()) continue;
    const senderType = typeof message.senderType === 'string' ? message.senderType : '';
    const messageType = typeof message.messageType === 'string' ? message.messageType : '';
    if (senderType === 'system') continue;
    if (ROLE === 'client' && senderType === 'admin' && !['booking_approved', 'manual_message', 'delivery_retry'].includes(messageType)) continue;
    const role = ROLE === 'admin' && senderType === 'admin' && messageType.startsWith('web_chat')
      ? 'internal'
      : message.direction === 'inbound' && (senderType === 'client' || senderType === 'admin') ? 'user' : 'bot';
    addMsg(role, message.text);
  }
}

async function loadHistory() {
  const actorId = getActorId();
  if (!actorId) return;
  const params = new URLSearchParams({ actorId });
  if (ROLE === 'admin') {
    const targetClientId = document.getElementById('targetClientId').value.trim();
    if (!targetClientId) {
      clearMessages();
      clearPatientHistory('Выберите Target Client ID, чтобы посмотреть историю пациента.');
      setError('');
      return;
    }
    if (targetClientId) params.set('targetClientId', targetClientId);
  }

  try {
    const res = await fetch('/history?' + params.toString());
    const data = await res.json();
    if (!res.ok) {
      setError(data.message || data.error || 'Не удалось загрузить историю.');
      return;
    }
    renderHistory(data.messages);
    if (ROLE === 'admin') {
      loadPatientHistory();
    }
  } catch (error) {
    setError('Не удалось загрузить историю.');
    console.error(error);
  }
}

async function loadPatientHistory() {
  if (ROLE !== 'admin') return;
  const actorId = getActorId();
  const targetClientId = document.getElementById('targetClientId').value.trim();
  if (!targetClientId) {
    clearPatientHistory('Выберите Target Client ID, чтобы посмотреть историю пациента.');
    return;
  }
  const params = new URLSearchParams({ actorId, targetClientId, view: 'patient' });
  try {
    const res = await fetch('/history?' + params.toString());
    const data = await res.json();
    if (!res.ok) {
      clearPatientHistory(data.message || data.error || 'Не удалось загрузить историю пациента.');
      return;
    }
    renderPatientHistory(data.messages);
  } catch (error) {
    clearPatientHistory('Не удалось загрузить историю пациента.');
    console.error(error);
  }
}

function showTyping() {
  const msgs = document.getElementById('messages');
  const el = document.createElement('div');
  el.className = 'typing';
  el.id = 'typing';
  el.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  msgs.appendChild(el);
  scrollDown();
}

function hideTyping() {
  document.getElementById('typing')?.remove();
}

async function sendMessage() {
  if (loading) return;
  const input = document.getElementById('input');
  const text = input.value.trim();
  if (!text) return;

  const actorId = getActorId();
  if (!actorId) {
    setError('Нужен actor id.');
    return;
  }

  setError('');
  input.value = '';
  autoResize(input);
  document.getElementById('sendBtn').disabled = true;
  loading = true;

  addMsg('user', text);
  showTyping();

  try {
    const payload = { actorId, text };
    if (ROLE === 'admin') {
      const targetClientId = document.getElementById('targetClientId').value.trim();
      if (targetClientId) payload.targetClientId = targetClientId;
    }

    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    hideTyping();

    if (!res.ok) {
      setError(data.message || data.error || 'Ошибка запроса.');
      addMsg('bot', 'Запрос не прошёл. Смотри текст ошибки выше.');
      return;
    }

    if (Array.isArray(data.replies) && data.replies.length > 0) {
      data.replies.forEach((reply) => addMsg('bot', reply.text || '...'));
    } else {
      addMsg('bot', '...');
    }
  } catch (error) {
    hideTyping();
    setError('Ошибка соединения.');
    addMsg('bot', 'Ошибка соединения. Попробуй ещё раз.');
    console.error(error);
  } finally {
    loading = false;
    document.getElementById('sendBtn').disabled = false;
    input.focus();
  }
}

function resetChat() {
  clearMessages();
  setError('');
  if (!DEFAULT_ACTOR_ID) {
    setActorId(generateActorId());
  }
}

ensureActorId();
applyPatientHistoryCollapsedState();
document.getElementById('actorId').addEventListener('change', (event) => {
  setActorId(event.target.value.trim() || generateActorId());
  loadHistory();
});
document.getElementById('targetClientId')?.addEventListener('change', () => {
  loadHistory();
});
loadHistory();
document.getElementById('input').focus();
</script>
</body>
</html>`;
}

function escHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
