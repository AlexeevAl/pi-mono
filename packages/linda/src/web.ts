// ============================================================================
// Linda — Web Channel Adapter
// HTTP server: serves chat UI + POST /chat API.
// Role: configurable (default: client).
// ============================================================================

import { createServer, type IncomingMessage as NodeRequest, type ServerResponse } from "node:http";
import type { IncomingMessage, LindaBot } from "./bot.js";
import type { AgentRole, LindaBridge } from "./types.js";

// ============================================================================
// Config
// ============================================================================

export interface WebAdapterConfig {
	port: number;
	/** Agent role for web sessions — default: "client" */
	role?: AgentRole;
	/** Allowed CORS origins. "*" = all (default). */
	allowedOrigins?: string;
	/** Firm ID — used to scope actor IDs */
	firmId: string;
	/** Firm name — shown in chat header */
	firmName?: string;
}

// ============================================================================
// Adapter
// ============================================================================

export class WebAdapter implements LindaBridge {
	readonly name = "web";

	canHandle(actorId: string): boolean {
		return actorId.startsWith("user_web_");
	}

	async sendDirectMessage(actorId: string, text: string): Promise<boolean> {
		// Web channel is request-response — no push capability yet
		console.warn(`[Web] Bridge push not supported for ${actorId}: ${text.slice(0, 60)}`);
		return false;
	}

	private readonly config: WebAdapterConfig;
	private readonly bot: LindaBot;
	private server: ReturnType<typeof createServer> | null = null;

	constructor(config: WebAdapterConfig, bot: LindaBot) {
		this.config = config;
		this.bot = bot;
	}

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	async start(): Promise<void> {
		this.server = createServer((req, res) => {
			void this.handleRequest(req, res).catch((err) => {
				console.error("[Web] Request error:", err);
				if (!res.headersSent) {
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "internal_error" }));
				}
			});
		});

		await new Promise<void>((resolve, reject) => {
			this.server!.listen(this.config.port, () => resolve());
			this.server!.once("error", reject);
		});

		console.log(`[Linda] Web client agent: ON | http://localhost:${this.config.port}`);
	}

	stop(): void {
		this.server?.close();
		console.log("[Web] Adapter stopped");
	}

	// -------------------------------------------------------------------------
	// Request dispatch
	// -------------------------------------------------------------------------

	private async handleRequest(req: NodeRequest, res: ServerResponse): Promise<void> {
		const origin = req.headers.origin ?? "*";
		const allowed = this.config.allowedOrigins ?? "*";
		const corsOrigin = allowed === "*" ? "*" : allowed.split(",").includes(origin) ? origin : "";

		res.setHeader("Access-Control-Allow-Origin", corsOrigin || "null");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = new URL(req.url ?? "/", `http://localhost:${this.config.port}`);

		// Serve chat UI
		if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/chat")) {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(buildChatHtml(this.config));
			return;
		}

		// Chat API
		if (req.method === "POST" && url.pathname === "/chat") {
			await this.handleChat(req, res);
			return;
		}

		// Reset API
		if (req.method === "POST" && url.pathname === "/reset") {
			await this.handleReset(req, res);
			return;
		}

		res.writeHead(404, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "not_found" }));
	}

	// -------------------------------------------------------------------------
	// POST /chat — main chat endpoint
	// Body: { userId: string, chatId?: string, text: string }
	// Response: { replies: Array<{ text: string, suggestions?: string[] }> }
	// -------------------------------------------------------------------------

	private async handleChat(req: NodeRequest, res: ServerResponse): Promise<void> {
		const body = await readJson<{ userId?: string; chatId?: string; text?: string }>(req);

		if (!body.userId || body.text === undefined) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "missing_fields", message: "userId and text are required" }));
			return;
		}

		const userId = String(body.userId).slice(0, 128);
		const chatId = body.chatId ? String(body.chatId).slice(0, 128) : userId;
		const text = String(body.text).slice(0, 4000);
		const role = this.config.role ?? "client";
		const msgId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		// Collect all sendText calls — bot may send multiple chunks
		const replies: Array<{ text: string; suggestions?: string[] }> = [];

		const incoming: IncomingMessage = {
			messageId: msgId,
			chatId,
			userId,
			text,
			channel: "web",
			role,
			sendText: async (replyText, suggestions) => {
				replies.push({ text: replyText, suggestions });
			},
			sendTyping: async () => {},
		};

		await this.bot.handleMessage(incoming);

		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ replies }));
	}

	// -------------------------------------------------------------------------
	// POST /reset
	// Body: { userId: string, chatId?: string }
	// -------------------------------------------------------------------------

	private async handleReset(req: NodeRequest, res: ServerResponse): Promise<void> {
		const body = await readJson<{ userId?: string; chatId?: string }>(req);

		if (!body.userId) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "missing_fields", message: "userId is required" }));
			return;
		}

		const userId = String(body.userId).slice(0, 128);
		const chatId = body.chatId ? String(body.chatId).slice(0, 128) : userId;

		await this.bot.resetChat(chatId, "web", userId);

		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true }));
	}
}

// ============================================================================
// Helpers
// ============================================================================

async function readJson<T>(req: NodeRequest): Promise<Partial<T>> {
	return new Promise((resolve, reject) => {
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

// ============================================================================
// Chat UI — served at GET /
// ============================================================================

function buildChatHtml(config: WebAdapterConfig): string {
	const title = config.firmName ? `${config.firmName} — Chat` : "Linda Chat";
	const chatPort = config.port;

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
    max-width: 680px;
    padding: 0 4px 16px;
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .header h1 { font-size: 1.5rem; line-height: 1; letter-spacing: -0.02em; }
  .header p  { font-size: 0.88rem; color: var(--muted); }

  .chatWrap {
    width: 100%;
    max-width: 680px;
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

  .msg { max-width: 82%; display: flex; flex-direction: column; gap: 4px; }
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

  .sugs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }
  .sug {
    border: 1px solid rgba(29,91,73,0.3);
    border-radius: 999px;
    padding: 5px 12px;
    font-size: 0.82rem;
    background: rgba(255,255,255,0.75);
    color: var(--ink);
    cursor: pointer;
    font-family: inherit;
    transition: background 120ms, transform 120ms;
  }
  .sug:hover { background: rgba(226,241,233,0.96); transform: translateY(-1px); }

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
    width: 7px; height: 7px;
    border-radius: 50%;
    background: var(--muted);
    animation: blink 1.2s infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink {
    0%, 80%, 100% { opacity: 0.3; }
    40%           { opacity: 1; }
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
    transition: border-color 120ms;
  }
  .inputRow textarea:focus { border-color: rgba(29,91,73,0.45); }

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
    transition: opacity 140ms, transform 140ms;
  }
  .sendBtn:disabled { opacity: 0.35; cursor: not-allowed; transform: none; }
  .sendBtn:not(:disabled):hover { opacity: 0.8; transform: scale(1.05); }
  .sendBtn svg { pointer-events: none; }

  .resetBtn {
    position: absolute;
    top: 14px;
    right: 16px;
    font-size: 0.78rem;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    padding: 4px 8px;
    border-radius: 999px;
    transition: background 120ms;
  }
  .resetBtn:hover { background: rgba(29,24,19,0.07); }
  .chatWrap { position: relative; }
</style>
</head>
<body>

<div class="header">
  <h1>${escHtml(config.firmName ?? "Chat")}</h1>
  <p>Powered by Linda</p>
</div>

<div class="chatWrap" id="chatWrap">
  <button class="resetBtn" onclick="resetChat()" title="Сбросить сессию">↺ reset</button>
  <div class="messages" id="messages"></div>
  <div class="inputRow">
    <textarea id="input" placeholder="Напишите сообщение…" rows="1"
      onkeydown="onKey(event)" oninput="autoResize(this)"></textarea>
    <button class="sendBtn" id="sendBtn" onclick="sendMessage()" title="Отправить">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    </button>
  </div>
</div>

<script>
const API   = 'http://localhost:${chatPort}';
const UID   = 'user_' + Math.random().toString(36).slice(2, 10);
let loading = false;

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

function addMsg(role, text, suggestions) {
  const msgs = document.getElementById('messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);

  if (suggestions && suggestions.length) {
    const sugsEl = document.createElement('div');
    sugsEl.className = 'sugs';
    suggestions.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'sug';
      btn.textContent = s;
      btn.onclick = () => { document.getElementById('input').value = s; sendMessage(); };
      sugsEl.appendChild(btn);
    });
    wrap.appendChild(sugsEl);
  }

  msgs.appendChild(wrap);
  scrollDown();
  return wrap;
}

function showTyping() {
  const msgs = document.getElementById('messages');
  const el   = document.createElement('div');
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
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  autoResize(input);
  document.getElementById('sendBtn').disabled = true;
  loading = true;

  addMsg('user', text);
  showTyping();

  try {
    const res  = await fetch(API + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: UID, chatId: UID, text }),
    });
    const data = await res.json();
    hideTyping();

    if (data.replies && data.replies.length > 0) {
      data.replies.forEach(r => addMsg('bot', r.text, r.suggestions));
    } else {
      addMsg('bot', '…');
    }
  } catch (err) {
    hideTyping();
    addMsg('bot', 'Ошибка соединения. Попробуйте ещё раз.');
    console.error(err);
  } finally {
    loading = false;
    document.getElementById('sendBtn').disabled = false;
    input.focus();
  }
}

async function resetChat() {
  if (!confirm('Сбросить сессию?')) return;
  await fetch(API + '/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: UID, chatId: UID }),
  }).catch(() => {});
  document.getElementById('messages').innerHTML = '';
}

// Auto-focus
document.getElementById('input').focus();
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
