# Control Layer Execution Plan

This plan turns `CONTROL_LAYER.md` into implementation work without trying to build a full agent OS.

Current boundary:

- `psf-engine-v2` owns authority, policy, runtime, planner, bridge, and contracts.
- `@psf/linda-agent` owns agent execution, channel adapters, skills loading, prompt assembly, and tool proxying.
- The first implementation should add control contracts and guard calls around existing behavior before replacing working flows.

## Goal

Build Control Layer v0.1:

```txt
Firm → Agent → Skill → Session → Policy → Action → Log
```

The first version is valid only if these six things are true:

```txt
Every firm has a config.
Every firm has two agents.
Every firm has an allowlist of skills.
Every session has state.
Every call goes through a guard.
Every action is logged.
```

The agent should stop being the authority for permissions and process state. It should become an executor:

```txt
control decision → skill execution → proposed output → post-check → delivery/effect
```

## Phase 0: Freeze the Contract

Owner: `pi-mono/packages/linda-agent`

Add shared TypeScript contracts that mirror the product spec:

- `FirmRecord`
- `AgentRecord`
- `SkillRecord`
- `AgentSession`
- `PolicyDecision`
- `ControlTurnRequest`
- `ControlTurnDecision`
- `AgentTurnProposal`
- `ControlPostCheckResult`
- `AuditEvent`

Recommended file:

```txt
packages/linda-agent/src/core/control-types.ts
```

Do not wire runtime behavior yet. This phase is just type authority for both repos.

Acceptance:

- contracts compile;
- no `any`;
- no inline imports;
- exported from `src/index.ts`;
- current agent behavior unchanged.

## Phase 1: Backend Control Endpoints

Owner: `psf-engine-v2`

Add three minimal backend endpoints:

```http
POST /api/agent/control/precheck
POST /api/agent/control/postcheck
POST /api/agent/audit/events
```

### `precheck`

Input: `ControlTurnRequest`

Responsibilities:

- verify firm exists and is active;
- verify agent exists and is active;
- verify channel is allowed;
- load session;
- resolve enabled firm skill packs;
- resolve allowed skills;
- pick `activeSkillId`;
- return `skillContext`, allowed actions, required disclaimers, and audit id.

### `postcheck`

Input: `AgentTurnProposal`

Responsibilities:

- validate client/admin message;
- block forbidden claims;
- validate proposed actions;
- create escalation notice if needed;
- return final deliverable text and executable actions;
- return session patch.

### `audit/events`

Responsibilities:

- append structured audit events;
- record blocked actions too;
- redact secrets and sensitive data;
- store large payloads by reference.

Acceptance:

- disabled firm blocks before LLM;
- disabled agent blocks before LLM;
- forbidden channel blocks before LLM;
- postcheck blocks obvious forbidden claims;
- every precheck creates or references an audit event.

## Phase 2: Add Control Client to `linda-agent`

Owner: `pi-mono/packages/linda-agent`

Extend `ClinicBackendClient` with:

```ts
precheckTurn(request: ControlTurnRequest): Promise<ControlTurnDecision>
postcheckTurn(proposal: AgentTurnProposal): Promise<ControlPostCheckResult>
writeAuditEvent(event: AuditEvent): Promise<void>
```

Keep existing endpoints during transition:

- `getAgentContext`
- `executeTool`
- `adminTool`
- profile/message helpers

Do not delete old context calls yet. During transition, `precheck` can wrap or derive from the existing `ClubAgentContext`.

Acceptance:

- client compiles;
- network errors fail closed for actions;
- user-facing fallback is explicit when control is unavailable;
- no direct action execution without either old hook logging or new audit id.

## Phase 3: Wrap Client Agent Turn

Owner: `pi-mono/packages/linda-agent`

Change `LindaClientAgent.decide()` to this shape:

```txt
1. build ControlTurnRequest
2. call precheck
3. if blocked: return safe blocked/escalation reply
4. load selected skill from activeSkillId
5. run LLM with skillContext and required disclaimers
6. build AgentTurnProposal
7. call postcheck
8. execute only approved effects
9. return finalClientMessage
```

Important migration note:

Current code has direct booking confirmation logic in `LindaClientAgent`.

Do not rip it out first. Move it behind control in two steps:

1. Detect booking intent as today, but submit it as a proposed action.
2. Only patch profile after postcheck returns an executable approved action.

Target proposed action:

```ts
{
  actionId: "update_lead_fields",
  reason: "client_requested_booking",
  payload: {
    identityPatch: {},
    profilePatch: {}
  }
}
```

Acceptance:

- no booking profile patch happens before postcheck;
- active skill comes from control decision;
- if control blocks, the client gets a short safe answer;
- if postcheck edits the message, only final text is delivered.

## Phase 4: Wrap Admin Agent Turn

Owner: `pi-mono/packages/linda-agent`

Change `LindaAdminAgent.decide()` to use the same control envelope:

```txt
1. local admin allowlist check
2. precheck
3. run admin skill
4. postcheck
5. execute approved admin tools
6. return finalAdminMessage
```

Keep local `allowedAdminIds` as an edge-level fast reject. It is not enough by itself.

Admin-specific guard rules:

- manual client message must include actor id and reason;
- profile override must include reason;
- booking confirmation must reference target session/client;
- no silent human impersonation unless explicitly allowed.

Acceptance:

- unauthorized admin still blocked locally;
- authorized admin still requires backend precheck;
- admin tool effects reference audit id;
- `send_to_client` and `confirm_booking` are logged as controlled actions.

## Phase 5: Skill Pack Loading

Owner: both repos

Short-term:

- keep `SKILL.md` files as execution prompts;
- store `FirmSkillPack` config in backend;
- backend returns selected `skillContext` and `stylePolicyId`.

Do not make `linda-agent` parse every firm skill pack as the source of truth. That would put authority back on the edge.

Recommended split:

```txt
psf-engine-v2
  firm profile
  active skill packs
  policies
  scenario state
  audit

pi-mono/packages/linda-agent
  local SKILL.md execution text
  runtime skill loading
  LLM call
  channel delivery
```

Acceptance:

- backend decides enabled skills;
- edge can only load a skill returned by control;
- edge fallback skill is allowed only if backend says fallback is allowed;
- skill pack changes do not require agent code changes.

## Phase 6: Audit-First Effects

Owner: both repos

Every effect executor call should carry:

```txt
firmId
sessionId
agentId
auditEventId
actionId
reason
payload
```

Effects:

- update lead/profile fields;
- request enrichment link;
- send admin notification;
- send client message;
- confirm booking;
- create CRM/webhook event.

Acceptance:

- action without `auditEventId` is rejected;
- failed effects are logged;
- blocked effects are logged;
- large payloads are stored by reference.

## Phase 7: Tests

Owner: both repos

Unit tests:

- precheck rejects disabled firm;
- precheck rejects disabled agent;
- precheck rejects forbidden channel;
- skill required input missing returns fallback/handoff;
- postcheck blocks medical guarantee;
- postcheck blocks legal guarantee;
- postcheck blocks booking without backend slot;
- audit event is created for blocked action.

`linda-agent` tests:

- client turn calls precheck before LLM;
- client booking patch is not called when postcheck blocks;
- client booking patch is called when postcheck approves action;
- admin unauthorized still blocks locally;
- admin tool execution includes audit id.

Manual demo:

- clinic client asks for guaranteed botox result;
- control blocks guarantee and creates admin handoff;
- admin sees operator note with reason and recommended action.

## Implementation Order

Do it in this order:

1. Add TypeScript control contracts in `linda-agent`.
2. Add backend endpoint stubs in `psf-engine-v2`.
3. Add `ClinicBackendClient` methods.
4. Wrap `LindaClientAgent` with precheck/postcheck without removing old logic.
5. Move direct booking profile patch behind approved proposed action.
6. Wrap `LindaAdminAgent`.
7. Require audit id for high-impact tools.
8. Add tests for blocked booking and forbidden claims.

## Do Not Build Yet

- visual skill builder;
- skill marketplace;
- arbitrary workflow language;
- multi-tenant WhatsApp socket host;
- self-modifying skill packs;
- agent-created agents;
- full RBAC matrix.

## Risks

### Risk: control layer becomes another prompt

Mitigation:

- policies must be deterministic checks where possible;
- LLM can classify risk, but deterministic guard blocks final delivery.

### Risk: edge and backend disagree on active skill

Mitigation:

- backend decision wins;
- edge only loads `activeSkillId` from precheck;
- local fallback is explicit and audited.

### Risk: migration breaks current booking flow

Mitigation:

- first wrap existing booking detection as a proposed action;
- only later move detection into scenario engine.

### Risk: audit log stores sensitive data

Mitigation:

- audit stores refs for full input/output;
- redact payment, government ID, secrets, and medical documents;
- keep policy tags and action metadata in the main event.

## First Real Milestone

Milestone is not "all control finished".

Milestone:

```txt
A client asks for booking.
The client agent proposes profile update.
Postcheck approves or blocks it.
The effect executor patches profile only if approved.
Audit log records the decision and action.
```

This proves the architecture: agent proposes, control decides, effect logs.
