# Linda — Architecture Documentation

> Conversational intelligence layer for PSF Engine.
> Multi-channel intake bot with role-based agent separation.

## Overview

Linda is a **runtime-controlled** conversational agent. The LLM is a semantic layer — it understands users and extracts data. All business logic, flow control, and state management live in code.

```
WhatsApp (client) ──┐
                     ├──► LindaBot ──► PSF Engine (source of truth)
Telegram (admin)  ──┘        │
                          Runtime
                       ┌────┴────┐
                    Guardrails  Validation
                    Logging     Redaction
```

### Key Principle

**PSF is the single source of truth.** Linda never commits state. All writes go through PSF; Linda reads state, injects context into LLM, validates locally, then defers to PSF.

---

## Turn Pipeline (8 steps)

Every incoming message goes through this exact pipeline in `bot.ts`:

```
1. PSF Pre-call        → runtime calls getTurn() BEFORE the LLM
2. Guardrails Pre-check → composite stuck detection (score-based)
3. Context Injection    → PSF state + guardrail hints → LLM prompt
4. LLM Execution       → role-aware prompt + tools, event streaming
5. Fallback Detection   → if LLM missed intent, runtime detects it (client only)
6. Guardrails Post-check→ update stuck counters, force escalation if needed
7. Fallback Replies     → runtime defaults if LLM returned empty
8. Log & Send           → structured JSON log, chunked text delivery
```

The LLM **never decides when to check PSF state** — the runtime always does it first.

---

## Role Separation

| | Client (WhatsApp) | Admin (Telegram) |
|---|---|---|
| **Prompt** | Warm, step-by-step guidance | Direct, business-like |
| **Tools** | `submit_data` only | + `list_sessions`, `view_session`, `add_note`, `override_field`, `send_to_client` |
| **Guardrails** | Strict (score threshold: 5, max 10 turns) | Relaxed (score threshold: 20, max 30 turns) |
| **Fallback intent** | Active — runtime detects intent if LLM misses | Disabled — admin states intent explicitly |
| **PSF scope** | Own session only | All sessions |

### How It Works

```typescript
// Channel adapters set the role:
// telegram.ts  → role: "admin"
// whatsapp.ts  → role: "client"

// Bot picks everything by role:
const systemPrompt = getSystemPrompt(role);      // prompts/index.ts
const tools = getToolsForRole(role, psf, ...);   // tools.ts
const guardrails = new ConversationGuardrails(    // guardrails.ts
  getGuardrailConfigForRole(role)
);
```

### Agent Policy

Each role has a policy object (`types.ts`) that defines capabilities:

```typescript
interface AgentPolicy {
  role: AgentRole;
  canViewAllSessions: boolean;
  canOverrideFields: boolean;
  canSendClientMessages: boolean;
  stuckDetectionEnabled: boolean;
  maxTurnsPerStep?: number;
  sessionScope: "own" | "all";
}
```

Currently used for guardrail config selection. Seam for future RBAC when admin tools connect to PSF admin API.

---

## File Map

### Core

| File | Lines | Purpose |
|---|---|---|
| `bot.ts` | 348 | Main engine: per-chat Agent management, 8-step turn pipeline |
| `types.ts` | 156 | PSF protocol contract, agent roles, policies |
| `psf.ts` | 70 | HMAC-signed HTTP client for PSF backend |
| `main.ts` | 176 | Entry point: env, wiring, TUI/daemon mode |
| `index.ts` | 31 | Public API re-exports |

### Prompts

| File | Purpose |
|---|---|
| `prompts/client.ts` | Warm prompt for end-users |
| `prompts/admin.ts` | Business prompt for operators |
| `prompts/index.ts` | `getSystemPrompt(role)` selector |
| `prompt.ts` | Backward-compat re-export |

### Tools

| File | Lines | Purpose |
|---|---|---|
| `tools.ts` | 247 | `getToolsForRole()` — client: `submit_data`, admin: + session management stubs |
| `intents.ts` | 74 | Intent registry: intent string → PSF pack ID, keyword fallback |

### Safety & Observability

| File | Lines | Purpose |
|---|---|---|
| `guardrails.ts` | 323 | Composite stuck detection (score = missed submits + stale data + validation fails + turn pressure) |
| `validation.ts` | 226 | Field-level + step-level payload validation with formal reason codes |
| `logger.ts` | 282 | Structured JSON turn logger with forensic fields |
| `redact.ts` | 116 | PII masking: patterns (phone, email, CC, passport, ID) + field-aware |

### Channel Adapters

| File | Lines | Purpose |
|---|---|---|
| `telegram.ts` | 242 | Long-polling adapter, role: admin |
| `whatsapp.ts` | 200 | Baileys adapter, QR auth, role: client |
| `tui.ts` | 279 | Interactive terminal UI for development |

---

## Guardrails — Composite Stuck Detection

Not a simple turn counter. A **scoring algorithm** based on multiple signals:

| Signal | Weight | Max |
|---|---|---|
| Consecutive missed `submit_data` calls | 1.5/turn | 4.5 |
| Stale data (no new valid fields) | 1.0/turn after 2 | 3.0 |
| Validation-only failures (rejects, no accepts) | 1.5/turn | 4.5 |
| High turn count (>4 turns on same step) | 0.5/turn | unbounded |

**Score >= 3** → warn (hint injected into LLM prompt)
**Score >= 5** → force escalation (runtime overrides LLM reply)
**10 turns absolute** → hard ceiling
**30min idle** → timeout hint

Counters reset when:
- Step changes (PSF advanced)
- Successful submit with new valid fields
- Session reset

---

## Validation

Two layers, applied **before data reaches PSF**:

### Field-Level (`validatePayload`)

| Check | Fields | Reason Code |
|---|---|---|
| Garbage/placeholder detection | All | `empty_or_placeholder` |
| Phone: min 7 digits | `phone` | `invalid_phone` |
| Email: pattern match | `email` | `invalid_email` |
| Name: min 2 chars, no all-digits | `name`, `fullName`, `firstName`, etc. | `invalid_name` |
| Age: 0-150 | `age` | `invalid_age` |
| City/Country: min 2 chars | `city`, `country` | `invalid_city` / `invalid_country` |
| String length: max 1000 | All strings | `too_long` |

### Step-Level (`validateForStep`)

Extends field-level with:
- **Required field tracking**: knows which fields this step requires
- **Already collected**: doesn't demand fields PSF already has
- **Missing required**: reports what's still needed
- **Sufficient flag**: `true` only when all required fields present and payload non-empty

---

## Structured Logging

Every turn produces **one JSON line** to stdout:

```json
{
  "ts": "2026-04-08T12:00:00.000Z",
  "level": "info",
  "event": "turn",
  "turnId": "msg_123",
  "sessionId": "sess_456",
  "userId": "user***78",
  "chatId": "chat***21",
  "channel": "whatsapp",
  "role": "client",
  "psfStatus": "active",
  "stepId": "collect_contact",
  "llm": {
    "calledSubmit": true,
    "extractedFields": ["name", "phone"],
    "replyLength": 142
  },
  "replySource": "llm",
  "effectiveOutcome": "progressed",
  "validation": {
    "acceptedCount": 2,
    "rejected": [{"field": "notes", "reason": "empty_or_placeholder"}]
  },
  "guardrailAction": "ok",
  "psfResult": {"status": "active", "stepId": "collect_address"},
  "durationMs": 2340
}
```

### Key Fields

| Field | Values | Why It Matters |
|---|---|---|
| `replySource` | `llm`, `fallback`, `guardrail`, `runtime_default`, `none` | Who actually answered — prevents "looks stable" when fallback carries 50% |
| `effectiveOutcome` | `progressed`, `stayed_same_step`, `validation_blocked`, `input_issue`, `guardrail_escalated`, `fallback_used`, `session_started`, `completed`, `error` | Real conversion funnel — not just "PSF returned 200" |
| `errorCode` | `psf_unreachable`, `unknown_intent`, `llm_error`, `fallback_submit_failed`, etc. | Programmatic alerting |

### PII Redaction

All log entries are redacted before output:
- Known sensitive fields (phone, email, name, passport, etc.) → masked
- Pattern detection in free text (email, phone, CC, Israeli ID) → `[EMAIL_REDACTED]` etc.
- User/chat IDs → `1234***89`

---

## PSF Protocol

Linda communicates with PSF through 3 endpoints:

### GET `/api/linda/turn`
**Runtime calls this before every LLM turn.** Returns current session state.

```typescript
// Request
{ userId: string, channel: LindaChannel }

// Response: TurnResponse
| { status: "no_session", sessionId: null }
| { status: "active", sessionId, step: TurnStep, inputIssue? }
| { status: "terminal", sessionId, outcome: TurnOutcome }
```

### POST `/api/linda/turn`
**LLM calls this via `submit_data` tool.** Sends extracted data for validation and commit.

```typescript
// Request
{ requestId, userId, channel, userText, extractedPayload, packId? }

// Response: same TurnResponse shape
```

### POST `/api/linda/session/reset`
**User sends /reset.** Clears session and agent state.

All requests are signed with HMAC-SHA256: `X-Bridge-Signature = HMAC(timestamp.body, sharedSecret)`.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PSF_BASE_URL` | Yes | — | PSF backend URL |
| `PSF_SHARED_SECRET` | Yes | — | HMAC signing key |
| `TELEGRAM_BOT_TOKEN` | Yes | — | Telegram bot API token |
| `TELEGRAM_ALLOWED_USER_IDS` | No | everyone | Comma-separated admin Telegram user IDs |
| `WHATSAPP_AUTH_DIR` | No | `./.linda/auth-whatsapp` | Baileys auth session directory |
| `WHATSAPP_ALLOWED_USER_IDS` | No | everyone | Comma-separated phone numbers |
| `LLM_PROVIDER` | No | `anthropic` | LLM provider |
| `LLM_MODEL` | No | `claude-sonnet-4-5` | Model name |
| `ANTHROPIC_API_KEY` | No* | — | Anthropic API key |
| `OPENAI_API_KEY` | No* | — | OpenAI API key |
| `LLM_API_KEYS` | No* | — | Multi-provider: `provider=key,provider=key` |

\* At least one API key required for the configured provider.

---

## Tests

**6 test files, 84 tests** covering all non-adapter modules:

| File | Tests | Covers |
|---|---|---|
| `validation.test.ts` | 26 | Garbage detection, all field validators, reason codes, step-level required fields |
| `redact.test.ts` | 16 | Field masking, pattern detection (email, phone, CC, ID), edge cases |
| `guardrails.test.ts` | 15 | Hard ceiling, composite scoring, counter resets, idle timeout |
| `roles.test.ts` | 12 | Prompt selection, tool registry per role, guardrail configs, policy values |
| `intents.test.ts` | 8 | PackId resolution, keyword fallback, case-insensitive, unknown text |
| `logger.test.ts` | 7 | Log shape, replySource, effectiveOutcome, error codes, PII redaction |

Run: `npm test` or `npx vitest run`

---

## Future: Phase 2 — Admin Tools

Admin tools in `tools.ts` are currently stubs returning `"not_implemented"`. When PSF admin API is ready:

1. Wire `list_sessions` → `GET /api/admin/sessions`
2. Wire `view_session` → `GET /api/admin/sessions/:id`
3. Wire `add_note` → `POST /api/admin/sessions/:id/notes`
4. Wire `override_field` → `POST /api/admin/sessions/:id/override` (+ audit log)
5. Wire `send_to_client` → cross-channel message delivery

The `AgentPolicy` object is ready for RBAC enforcement in tool execute() functions.

### Transition to B (separate agent classes)

When admin workflow stabilizes, extract:
- `ClientAgent` ← current client path in `bot.ts`
- `AdminAgent` ← admin path with dedicated process() logic

The seams are already in place: `getSystemPrompt(role)`, `getToolsForRole(role)`, `getGuardrailConfigForRole(role)`. Separate classes would just own these calls instead of switching on role.
