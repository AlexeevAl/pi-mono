import { createServer, type IncomingMessage as NodeRequest, type ServerResponse } from "node:http";
import type { LindaAdminAgent } from "../agents/LindaAdminAgent.js";
import type { LindaClientAgent } from "../agents/LindaClientAgent.js";
import type { AgentDecision, ClubAgentContext } from "../core/types.js";

export interface WebChannelConfig {
	port: number;
	role: "client" | "admin";
	allowedOrigins?: string;
	firmName?: string;
	defaultActorId?: string;
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

	constructor(
		private readonly config: WebChannelConfig,
		private readonly agents: {
			clientAgent?: LindaClientAgent;
			adminAgent?: LindaAdminAgent;
		},
	) {}

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
		const body = await readJson<WebChatRequest>(req);
		const text = String(body.text ?? "").trim();

		if (!text) {
			this.json(res, 400, {
				error: "missing_fields",
				message: "text is required",
			});
			return;
		}

		const actorId = this.resolveActorId(body.actorId);
		const result =
			this.config.role === "admin"
				? await this.runAdmin(actorId, text, body.targetClientId)
				: await this.runClient(actorId, text);

		const response: WebChatResponse = {
			replies: result.reply ? [{ text: result.reply }] : [],
			context: result.context,
		};

		this.json(res, 200, response);
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
  .bubble {
    padding: 10px 16px;
    border-radius: 18px;
    font-size: 0.97rem;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
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
  bubble.textContent = text;
  wrap.appendChild(bubble);

  msgs.appendChild(wrap);
  scrollDown();
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
  document.getElementById('messages').innerHTML = '';
  setError('');
  if (!DEFAULT_ACTOR_ID) {
    setActorId(generateActorId());
  }
}

ensureActorId();
document.getElementById('actorId').addEventListener('change', (event) => {
  setActorId(event.target.value.trim() || generateActorId());
});
document.getElementById('input').focus();
</script>
</body>
</html>`;
}

function escHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
