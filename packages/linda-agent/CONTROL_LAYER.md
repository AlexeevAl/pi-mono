# Control Layer v0.1

This document defines the minimal external control layer for Linda-style rented agent units.

The point is simple: prompts do not own permissions, state, policy, escalation, or audit. The agent can propose text or an action. The control layer decides what is allowed.

## Product Unit

```txt
Agent Rental Unit
├── Firm Registry
├── Agent Registry
├── Skill Registry
├── Session Store
├── Policy Guard
├── Scenario Engine
├── Effect Executor
└── Audit Log
```

Runtime flow:

```txt
Business Channel
WhatsApp / Web / Telegram
        ↓
Agent Adapter
client_agent / admin_agent
        ↓
Control Layer
firm, session, permissions, current step, policy
        ↓
Skill Registry
available skills for this firm and agent role
        ↓
Scenario Engine
next step and active skill
        ↓
Agent Skill Execution
LLM executes the selected step
        ↓
Policy Guard
validate proposed response or action
        ↓
Effect Executor
CRM / calendar / email / webhook
        ↓
Audit Log
what happened and why
```

## Non-Negotiable Rule

Control is outside the prompt.

Core invariant:

```txt
Every firm has a config.
Every firm has two agents.
Every firm has an allowlist of skills.
Every session has state.
Every call goes through a guard.
Every action is logged.
```

Before agent execution:

- identify the firm;
- identify the agent;
- load the session;
- resolve active skill packs;
- resolve allowed skills;
- run pre-policy checks;
- decide the active skill and current step.

After agent execution:

- validate the proposed response;
- validate any proposed action;
- block forbidden claims;
- update session state;
- escalate if needed;
- write an audit event.

## Minimal Registries

### Firm Registry

```ts
type FirmRecord = {
  firmId: string;
  displayName: string;
  status: "active" | "paused" | "disabled";
  activeSkillPackIds: string[];
  allowedChannels: ChannelId[];
  allowedActions: ActionId[];
  defaultLocale: LocaleId;
  supportedLocales: LocaleId[];
};
```

Hard rule:

- disabled firms cannot receive agent actions;
- channels not listed in `allowedChannels` are rejected before LLM execution;
- actions not listed in `allowedActions` cannot be executed even if a skill requests them.

### Agent Registry

```ts
type AgentRecord = {
  agentId: string;
  firmId: string;
  role: "client_agent" | "admin_agent";
  status: "active" | "paused" | "disabled";
  allowedChannels: ChannelId[];
  allowedSkillIds: string[];
  allowedActions: ActionId[];
};
```

Hard rule:

- client agents cannot perform admin-only actions;
- admin agents cannot silently impersonate humans unless the action is explicitly allowed and logged;
- an agent cannot use a skill that is not enabled for its firm and role.

### Skill Registry

```ts
type SkillRecord = {
  skillId: string;
  name: string;
  description: string;
  allowedFor: Array<"client_agent" | "admin_agent">;
  requiredInputs: string[];
  outputSchemaId: string;
  permissions: ActionId[];
  forbiddenActions: ActionId[];
  auditLogRequired: boolean;
  fallbackBehavior: "ask_for_missing_data" | "handoff" | "block";
};
```

Hard rule:

- missing required inputs means no skill execution unless fallback allows asking for missing data;
- skill permissions are an upper bound, not a suggestion;
- forbidden actions win over allowed actions.

## Session Store

```ts
type AgentSession = {
  sessionId: string;
  firmId: string;
  customerId: string | null;
  channel: ChannelId;
  status:
    | "new"
    | "collecting"
    | "qualified"
    | "needs_human"
    | "booked"
    | "closed";
  currentStep: string;
  activeSkillId: string | null;
  collectedFields: Record<string, unknown>;
  missingFields: string[];
  lastAgentAction: AgentActionSummary | null;
  escalation: EscalationState | null;
  updatedAt: string;
};
```

The agent should not reconstruct process state from chat history when the session store has a state field. Chat history is evidence. Session state is authority.

## Policy Guard

Policy guard runs twice:

1. `preCheck`: before the agent gets to execute a skill.
2. `postCheck`: after the agent proposes a response or action.

```ts
type PolicyDecision = {
  allowed: boolean;
  blockedReason?: string;
  requiredEscalation?: EscalationReason;
  requiredDisclaimers: string[];
  redactions: RedactionInstruction[];
  auditTags: string[];
};
```

Minimum policy areas:

- tone policy;
- domain policy;
- legal or medical disclaimers;
- forbidden claims;
- language rules;
- escalation triggers;
- PII and sensitive data handling.

Forbidden claims for clinic mode:

- medical diagnosis;
- guaranteed treatment result;
- final price without administrator confirmation;
- confirmed booking without backend slot;
- doctor approval without explicit backend or human approval.

Forbidden claims for legal mode:

- guaranteed legal result;
- guaranteed process duration;
- final legal advice without attorney review;
- claim that documents are sufficient without review;
- filing confirmation without backend or human confirmation.

## Escalation Layer

```ts
type EscalationRule = {
  reason: EscalationReason;
  trigger: string;
  severity: "low" | "medium" | "high";
  target: "admin_agent" | "human_operator" | "specialist";
  recommendedAction: string;
};
```

Minimum triggers:

- client asks for a human;
- client is angry or distrustful;
- client asks for a forbidden guarantee;
- client reports medical, legal, safety, or payment risk;
- required data is missing after configured attempts;
- agent confidence is below threshold;
- backend data needed for a safe answer is unavailable.

Escalation output:

```ts
type EscalationNotice = {
  sessionId: string;
  firmId: string;
  reason: EscalationReason;
  severity: "low" | "medium" | "high";
  clientSummary: string;
  operatorNotes: OperatorNotes;
  recommendedAction: string;
};
```

## Audit Log

Every controlled step writes an audit event.

```ts
type AuditEvent = {
  eventId: string;
  timestamp: string;
  firmId: string;
  sessionId: string;
  agentId: string;
  channel: ChannelId;
  skillCalled: string | null;
  inputRef: string;
  outputRef: string | null;
  decisionReason: string;
  policyDecision: PolicyDecision;
  humanEscalation: EscalationNotice | null;
  actionExecuted: ActionExecution | null;
};
```

Log data rules:

- store references for large inputs and outputs, not giant blobs in every event;
- redact payment cards, government IDs, medical documents, and secrets;
- record blocked actions, not only successful actions;
- record why a skill was selected.

## Control Request Contract

The agent adapter sends this before a turn:

```ts
type ControlTurnRequest = {
  firmId: string;
  agentId: string;
  role: "client_agent" | "admin_agent";
  channel: ChannelId;
  sessionId: string;
  incomingMessage: {
    text: string;
    localeHint?: string;
    receivedAt: string;
  };
};
```

The control layer returns:

```ts
type ControlTurnDecision = {
  allowed: boolean;
  blockedReason?: string;
  firm: FirmRecord;
  agent: AgentRecord;
  session: AgentSession;
  activeSkillId: string;
  allowedSkillIds: string[];
  allowedActions: ActionId[];
  skillContext: Record<string, unknown>;
  requiredDisclaimers: string[];
  stylePolicyId: string;
  humanHandoff: boolean;
  handoffReason?: EscalationReason;
  auditEventId: string;
};
```

## Proposed Agent Output Contract

The agent returns a proposal, not an already trusted outcome:

```ts
type AgentTurnProposal = {
  auditEventId: string;
  sessionId: string;
  agentId: string;
  skillId: string;
  clientMessage?: string;
  adminMessage?: string;
  proposedActions: ProposedAction[];
  extractedFields: Record<string, unknown>;
  operatorNotes?: OperatorNotes;
  confidence: number;
};
```

The control layer then returns:

```ts
type ControlPostCheckResult = {
  allowed: boolean;
  blockedReason?: string;
  finalClientMessage?: string;
  finalAdminMessage?: string;
  executableActions: ActionExecution[];
  sessionPatch: Partial<AgentSession>;
  escalation?: EscalationNotice;
  auditEventId: string;
};
```

## MVP Scope

Build only this first:

- firm registry;
- agent registry;
- skill registry;
- session store;
- policy guard;
- audit log.

Do not build yet:

- visual skill builder;
- skill marketplace;
- complex RBAC;
- universal workflow language;
- self-generating agents;
- multi-tenant WhatsApp runtime in one process.

## Acceptance Criteria

- A disabled firm cannot receive actions.
- A disabled agent cannot execute a turn.
- A client agent cannot run admin-only skills.
- A skill cannot run if required inputs are missing unless its fallback allows data collection.
- A forbidden claim is blocked after generation before delivery.
- A missing backend price, staff member, service, or slot causes handoff or clarification, not invention.
- Every turn produces an audit event.
- Every executed effect references an audit event.
- Escalation has a reason, severity, recommended action, and operator notes.
- Session state is updated from controlled output, not from raw LLM memory.
