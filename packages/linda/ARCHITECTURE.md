# Linda — Architecture Documentation

> Conversational intelligence layer for PSF Engine.
> Multi-channel intake bot with role-based agent separation and deployment-level tenant isolation.

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
                       └────┬────┘
                         FirmConfig
                    (tenant context)
```

### Key Principle

**PSF is the single source of truth.** Linda never commits state. All writes go through PSF; Linda reads state, injects context into LLM, validates locally, then defers to PSF.

---

## Tenant Architecture (Deployment-Level Isolation)

**One Linda instance = one firm.** Tenancy is not runtime-switched — each deployment reads a single `FIRM_ID` from env and operates exclusively in that tenant's scope.

### FirmConfig

All per-firm settings are loaded at startup into `FirmConfig`:

```typescript
interface FirmConfig {
  id: string;                              // "acme_law_il"
  name: string;                            // "Acme Law IL"
  activePacks: string[];                   // ["relocation_v1"] — PSF pack allowlist
  defaultPackId?: string;                  // skip intent detection for single-scenario firms
  language?: "ru" | "en" | "he";
  toneProfile?: "formal" | "warm" | "neutral";
  channels: FirmChannels;
}

interface FirmChannels {
  whatsappClient: { enabled: boolean; authDir: string; allowedUserIds: string[] };
  telegramAdmin:  { enabled: boolean; botToken: string; allowedUserIds: number[] };
}
```

### Tenant Namespacing

| Concept | Format | Example |
|---|---|---|
| Chat key (guardrails, memory) | `${firmId}:${channel}:${chatId}` | `acme_law_il:whatsapp:+972501234567` |
| Actor ID (PSF sessions) | `user_${ch}_${firmId}_${userId}` | `user_wa_acme_law_il_+972501234567` |
| Channel key (PSF state table) | `${firmId}:${channel}:${userId}` | `acme_law_il:telegram:253432559` |

### Pack Allowlist Enforcement

`assertPackAllowed(firm, packId)` gates every attempt to start or advance a session:

- **`submit_data` tool** — returns `pack_not_allowed` before calling PSF if pack not in `activePacks`
- **Fallback intent detection** — runtime discards detected pack if not in `activePacks`
- Empty `activePacks` = allow all (dev / single-firm setup)

### Per-Firm Intent Overrides

`firm-intents.ts` holds an isolated override map that merges on top of the global `INTENT_REGISTRY`:

```typescript
// firm-intents.ts
export const FIRM_INTENT_OVERRIDES: Record<string, Partial<Record<string, IntentEntry>>> = {
  // "acme_law": { mortgage: { packId: "acme_mortgage_v2", keywords: [...] } },
};
```

`resolvePackId(intent, firmId?)` and `detectIntentFromText(text, firmId?)` apply firm overrides first, then fall back to the global registry.

### Bootstrap: create-firm Wizard

```bash
# Interactive
linda-create-firm

# Non-interactive (CI / scripting)
linda-create-firm --config='{"firmId":"acme_law_il","firmName":"Acme Law","activePacks":["relocation_v1"],"psfBaseUrl":"https://psf.example.com","psfSecret":"secret","tgEnabled":true,"tgToken":"bot:123","tgAllowedUserIds":"253432559","waEnabled":false}'

# Custom output file
linda-create-firm --out=.env.acme_law
```

Generates a 3-block `.env` file: Firm Identity / WhatsApp Client / Telegram Admin.

---

## Role Separation

Two channels, two distinct agent personalities:

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
const systemPrompt = getSystemPrompt(role, firm);    // prompts/index.ts — firm-injected header
const tools = getToolsForRole(role, psf, ..., firm); // tools.ts — firm enforces pack allowlist
const guardrails = new ConversationGuardrails(
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

---

## Turn Pipeline (8 steps)

Every incoming message goes through this exact pipeline in `bot.ts`:

```
1. PSF Pre-call         → runtime calls getTurn(firmId) BEFORE the LLM
2. Guardrails Pre-check → composite stuck detection (score-based)
3. Context Injection    → PSF state + guardrail hints → LLM prompt
4. LLM Execution        → role-aware prompt + tools, event streaming
5. Fallback Detection   → if LLM missed intent, runtime detects it (client only)
6. Guardrails Post-check→ update stuck counters, force escalation if needed
7. Fallback Replies     → runtime defaults if LLM returned empty
8. Log & Send           → structured JSON log (includes firmId), chunked delivery
```

The LLM **never decides when to check PSF state** — the runtime always does it first.

---

## File Map

### Core

| File | Lines | Purpose |
|---|---|---|
| `bot.ts` | ~360 | Main engine: per-chat Agent management, 8-step turn pipeline, firm-scoped chatKey |
| `types.ts` | ~200 | PSF protocol contract, FirmConfig/FirmChannels, agent roles, policies |
| `psf.ts` | ~85 | HMAC-signed HTTP client for PSF backend — firmId in every request |
| `main.ts` | ~270 | Entry point: loadFirmConfig(), conditional adapter startup, TUI/daemon mode |
| `index.ts` | 31 | Public API re-exports |

### Tenant / Firm

| File | Purpose |
|---|---|
| `firm-intents.ts` | Per-firm intent override map — isolated from global registry |
| `intents.ts` | Intent registry + `resolvePackId(intent, firmId?)` + `assertPackAllowed()` |
| `create-firm.ts` | 3-block interactive CLI wizard for bootstrapping firm `.env` |

### Prompts

| File | Purpose |
|---|---|
| `prompts/client.ts` | Warm prompt for end-users |
| `prompts/admin.ts` | Business prompt for operators |
| `prompts/index.ts` | `getSystemPrompt(role, firm?)` — injects `[FIRM]`, `[LANGUAGE]`, `[TONE]` header |
| `prompt.ts` | Backward-compat re-export |

### Tools

| File | Lines | Purpose |
|---|---|---|
| `tools.ts` | ~720 | `getToolsForRole(role, psf, ..., firm)` — `submit_data` enforces pack allowlist |
| `intents.ts` | ~90 | Intent registry + firm-aware pack resolution + `assertPackAllowed` |

### Safety & Observability

| File | Lines | Purpose |
|---|---|---|
| `guardrails.ts` | 323 | Composite stuck detection (score = missed submits + stale data + validation fails + turn pressure) |
| `validation.ts` | 226 | Field-level + step-level payload validation with formal reason codes |
| `logger.ts` | ~290 | Structured JSON turn logger — includes `firmId` as primary grouping key |
| `redact.ts` | 116 | PII masking: patterns (phone, email, CC, passport, ID) + field-aware |

### Channel Adapters

| File | Lines | Purpose |
|---|---|---|
| `telegram.ts` | 242 | Long-polling adapter, role: **admin** |
| `whatsapp.ts` | ~210 | Baileys adapter, QR auth, role: **client** |
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
  "ts": "2026-04-09T12:00:00.000Z",
  "level": "info",
  "event": "turn",
  "turnId": "msg_123",
  "firmId": "acme_law_il",
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
| `firmId` | firm identifier | Primary key for log aggregation and multi-tenant triage |
| `replySource` | `llm`, `fallback`, `guardrail`, `runtime_default`, `none` | Who actually answered |
| `effectiveOutcome` | `progressed`, `stayed_same_step`, `validation_blocked`, `input_issue`, `guardrail_escalated`, `fallback_used`, `session_started`, `completed`, `error` | Real conversion funnel |
| `errorCode` | `psf_unreachable`, `unknown_intent`, `llm_error`, `fallback_submit_failed`, etc. | Programmatic alerting |

---

## PSF Protocol

Linda communicates with PSF through 3 endpoints. **`firmId` is required in every call.**

### GET `/api/linda/turn?userId=&channel=&firmId=`

Runtime calls this before every LLM turn. Returns current session state.

```typescript
// Query params (all required)
{ userId: string, channel: LindaChannel, firmId: string }

// Response: TurnResponse
| { status: "no_session", sessionId: null }
| { status: "active", sessionId, step: TurnStep, inputIssue? }
| { status: "terminal", sessionId, outcome: TurnOutcome }
```

### POST `/api/linda/turn`

LLM calls this via `submit_data` tool. Sends extracted data for validation and commit.

```typescript
// Body (all required except packId/entryPoint)
{ requestId, userId, channel, firmId, userText, extractedPayload, packId? }

// Response: same TurnResponse shape
```

### POST `/api/linda/session/reset`

User sends /reset. Clears session and agent state.

```typescript
// Body (all required)
{ userId, channel, firmId }
```

All requests are signed with HMAC-SHA256: `X-Bridge-Signature = HMAC(timestamp.body, sharedSecret)`.

---

## Environment Variables

### Block 1 — Firm Identity

| Variable | Required | Default | Description |
|---|---|---|---|
| `FIRM_ID` | **Yes** | — | Unique firm identifier (e.g. `acme_law_il`) |
| `FIRM_NAME` | No | same as `FIRM_ID` | Human-readable name — injected into system prompt |
| `FIRM_ACTIVE_PACKS` | No* | allow all | Comma-separated PSF pack IDs this firm can use |
| `FIRM_DEFAULT_PACK_ID` | No | — | Skip intent detection; must be in `FIRM_ACTIVE_PACKS` |
| `FIRM_LANGUAGE` | No | — | `ru` / `en` / `he` — hint injected into system prompt |
| `FIRM_TONE` | No | `warm` | `warm` / `formal` / `neutral` |

\* Required when `WHATSAPP_ENABLED=true`

### Block 2 — Client Agent (WhatsApp)

| Variable | Required | Default | Description |
|---|---|---|---|
| `WHATSAPP_ENABLED` | No | `true` | Enable WhatsApp client agent |
| `WHATSAPP_AUTH_DIR` | No | `./.linda/auth/${FIRM_ID}-whatsapp` | Baileys auth session storage |
| `WHATSAPP_ALLOWED_USER_IDS` | No | everyone | Comma-separated phone numbers (without @s.whatsapp.net) |

### Block 3 — Admin Agent (Telegram)

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_ADMIN_ENABLED` | No | `true` | Enable Telegram admin agent |
| `TELEGRAM_BOT_TOKEN` | Yes (if enabled) | — | Bot token from @BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | No | everyone | Numeric Telegram user IDs — **strongly recommended for prod** |

### Infrastructure

| Variable | Required | Default | Description |
|---|---|---|---|
| `PSF_BASE_URL` | **Yes** | — | PSF backend URL |
| `PSF_SHARED_SECRET` | **Yes** | — | HMAC signing key |
| `LLM_PROVIDER` | No | `anthropic` | LLM provider |
| `LLM_MODEL` | No | `claude-sonnet-4-5` | Model name |
| `ANTHROPIC_API_KEY` | No* | — | Anthropic API key |
| `OPENAI_API_KEY` | No* | — | OpenAI API key |
| `LLM_API_KEYS` | No* | — | Multi-provider: `provider=key,provider=key` |

\* At least one API key required for the configured provider.

---

## Tests

**6 test files, 84+ tests** covering all non-adapter modules:

| File | Tests | Covers |
|---|---|---|
| `validation.test.ts` | 26 | Garbage detection, all field validators, reason codes, step-level required fields |
| `redact.test.ts` | 16 | Field masking, pattern detection (email, phone, CC, ID), edge cases |
| `guardrails.test.ts` | 15 | Hard ceiling, composite scoring, counter resets, idle timeout |
| `roles.test.ts` | 12 | Prompt selection, tool registry per role, guardrail configs, policy values — all with FirmConfig |
| `intents.test.ts` | 8 | PackId resolution, keyword fallback, case-insensitive, unknown text |
| `logger.test.ts` | 7 | Log shape, replySource, effectiveOutcome, error codes, PII redaction |

Run: `npm test` or `npx vitest run`

---

## Known Gaps / Tech Debt

### firmId optional on legacy paths

Linda routes enforce `firmId` as required. A few non-Linda PSF paths (`whatsapp.ts` native adapter, `firm/cases` route) predate tenant isolation and do not pass `firmId`. They compile because the param is `optional`, but they will store sessions with `firm_id = null`.

**Action**: either migrate these paths to pass `firmId` or explicitly mark them as non-tenant-aware and gate them out in production.

### COALESCE semantics on session conflict

When `upsertSession` hits `ON CONFLICT`, it uses `COALESCE(EXCLUDED.firm_id, existing.firm_id)` — meaning an update without `firmId` silently keeps the existing value. This is safe for the Linda path (firmId is always present) but could mask a firm mismatch if two firms share an actorId by collision.

**Action**: add collision-detection test suite covering firm_id mismatch on conflict.

### Admin route firmId is query-param only

`GET /api/admin/sessions?firmId=` relies on the caller passing the correct firmId. No server-side token-binding enforces it.

**Action**: when admin auth is implemented, bind token to firmId server-side so the param can be verified, not just accepted.

### FirmConfig.policies not yet wired

`maxTurnsPerStep`, `requireHumanHandoff`, `escalationMessage` are typed in `FirmConfig.policies` but not read by guardrails or bot logic.

---

## Future: Phase 2 — Admin Tools

Admin tools in `tools.ts` currently call real PSF endpoints (`list_sessions`, `view_session`, `add_note`, `override_field`, `send_to_client`) but PSF admin API coverage is partial. Remaining work:

1. Wire `add_note` → `POST /api/admin/sessions/:id/notes`
2. Wire `override_field` → `POST /api/admin/sessions/:id/override` (+ audit log)
3. Wire `send_to_client` → cross-channel message delivery via `BridgeRegistry`

The `AgentPolicy` object is ready for RBAC enforcement in tool `execute()` functions.

### Transition to separate agent classes

When admin workflow stabilizes, extract:

- `ClientAgent` ← current client path in `bot.ts`
- `AdminAgent` ← admin path with dedicated `process()` logic

The seams are already in place: `getSystemPrompt(role, firm)`, `getToolsForRole(role, ..., firm)`, `getGuardrailConfigForRole(role)`.
