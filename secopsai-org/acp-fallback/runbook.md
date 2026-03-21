# SecOpsAI ACP One-Shot Runbook

## Goal

Run SecOpsAI role agents through ACP one-shot sessions when persistent thread-bound sessions are not available.

This runbook covers both:
1. the **12 role wrappers** for direct specialist execution
2. the **orchestrator wrapper** for routing and merged outputs

## When to use this model

Use this fallback in surfaces where thread-bound persistent sessions are unavailable.

Current pattern:
- role definitions live in `../agents/`
- routing rules live in `../orchestration-runbook.md`
- operator dispatch defaults live in `../dispatch-matrix.md`
- execution happens as ACP one-shot runs
- continuity is preserved by stable labels, profile files, and wrapper prompts

## Standard runtime

Use this runtime shape:

```json
{
  "runtime": "acp",
  "agentId": "codex",
  "mode": "run",
  "thread": false,
  "cwd": "/Users/chrixchange/.openclaw/workspace"
}
```

Notes:
- default ACP harness: `codex`
- swap `agentId` later if you want a different allowed ACP agent
- these are one-shot runs, not persistent sessions

## Available wrappers

### Specialists
- `platform/software-architect`
- `platform/backend-architect`
- `platform/ai-engineer`
- `platform/devops-automator`
- `security/security-engineer`
- `security/threat-detection-engineer`
- `product/product-manager`
- `product/ui-designer`
- `revenue/content-creator`
- `revenue/outbound-strategist`
- `revenue/sales-engineer`
- `support/support-responder`

### Control plane
- `exec/agents-orchestrator`

## Prompt sources

Prompt wrappers live under:
- `prompts/<department>__<role>.md`

Examples:
- `prompts/platform__software-architect.md`
- `prompts/security__security-engineer.md`
- `prompts/exec__agents-orchestrator.md`

Each wrapper points back to the authoritative profile or runbook files.

## Standard task structure

Each role task should:
1. name the intended stable label
2. point to the source profile file
3. tell the harness to internalize that role for the current run
4. define the concrete task to perform
5. request a concise, structured output

Template:

```text
You are acting as SecOpsAI role: <department/role>.

Use this profile as source of truth:
<absolute-profile-path>

Internalize that role for this run, then complete the following task:
<actual-task>

Constraints:
- Work in /Users/chrixchange/.openclaw/workspace
- Treat the profile file as authoritative for tone, responsibilities, and working style
- Do not invent a different role
- Return a concise result with clear bullets
```

## Fast operator workflow

### Option A — direct role run
Use this when the owning role is obvious.

1. pick the matching wrapper from `prompts/`
2. replace `{{TASK}}` with the exact task
3. spawn an ACP one-shot run
4. use the output directly or hand it back to the orchestrator

### Option B — orchestrated run
Use this when the task spans multiple functions or needs role selection.

1. use `prompts/exec__agents-orchestrator.md`
2. ask it to classify the request and produce a dispatch plan
3. run only the specialist roles it recommends
4. merge outputs into one final answer with owners, blockers, and next actions

## Routing guidance

Use the orchestrator when the task is ambiguous, cross-functional, or externally sensitive.

Quick ownership guide:
- scope, prioritization, product definition -> `product/product-manager`
- architecture and irreversible design trade-offs -> `platform/software-architect`
- backend/data/API design -> `platform/backend-architect`
- AI workflows and evals -> `platform/ai-engineer`
- CI/CD, infra, rollout safety -> `platform/devops-automator`
- appsec, trust boundaries, security claims -> `security/security-engineer`
- detections, ATT&CK, hunt logic -> `security/threat-detection-engineer`
- interface quality and accessibility -> `product/ui-designer`
- content and messaging -> `revenue/content-creator`
- outbound strategy -> `revenue/outbound-strategist`
- demos, POCs, technical sales support -> `revenue/sales-engineer`
- support triage and customer issue handling -> `support/support-responder`

## Logging ACP fallback runs into Mission Control

When a real ACP fallback run starts or completes, log it into Supabase so Mission Control reflects actual orchestrator activity rather than dashboard-only mutations.

Helpers:
- `secopsai-org/acp-fallback/log-run.sh <payload.json>`
- `secopsai-org/acp-fallback/log-run.py <payload.json>`
- example payload: `secopsai-org/acp-fallback/examples/orchestrator-run-log.example.json`

The logger reads the Supabase URL + anon key from:
- `/Users/chrixchange/.openclaw/workspace/secopsai-dashboard/config.js`

Minimal pattern:
1. create a JSON payload with a `run` object for `agent_runs`
2. optionally include an `event` object for `dashboard_events`
3. call `log-run.sh payload.json`
4. keep `role_label` stable (`exec/agents-orchestrator` or the specialist role)
5. use `source_surface: "acp-fallback"` for these workflow-originated entries

Suggested status mapping:
- before execution: `queued` or `running`
- after success: `completed`
- after failure: `failed`
- on operator stop: `cancelled`

## Launcher shortcut

Use the included script to render a final prompt:

```bash
secopsai-org/acp-fallback/launch-role.sh <department/role> <task...>
```

Examples:

```bash
secopsai-org/acp-fallback/launch-role.sh \
  platform/software-architect \
  "Review the current SecOpsAI org structure and propose a minimal orchestrator design."
```

```bash
secopsai-org/acp-fallback/launch-role.sh \
  exec/agents-orchestrator \
  "Classify this request, choose the smallest role set needed, and return a dispatch plan plus merged operator summary: design a secure detections dashboard and prepare launch messaging."
```

## Example: specialist one-shot

```text
You are acting as SecOpsAI role: platform/software-architect.

Use this profile as source of truth:
/Users/chrixchange/.openclaw/workspace/secopsai-org/agents/platform/software-architect.md

Internalize that role for this run, then complete the following task:
Review the current SecOpsAI org structure and propose a minimal orchestrator design for coordinating the first 12 roles.

Constraints:
- Work in /Users/chrixchange/.openclaw/workspace
- Treat the profile file as authoritative for tone, responsibilities, and working style
- Do not invent a different role
- Return a concise result with clear bullets
```

## Example: orchestrated intake

```text
You are acting as SecOpsAI role: exec/agents-orchestrator.

Use these files as source of truth:
- /Users/chrixchange/.openclaw/workspace/secopsai-org/agents/exec/agents-orchestrator.md
- /Users/chrixchange/.openclaw/workspace/secopsai-org/orchestration-runbook.md

Internalize that role for this run, then complete the following task:
Classify this request, choose the smallest role set needed, and return a dispatch plan plus merged operator summary: create a launch-ready proposal for a secure detections dashboard with clear backend scope, security claims guardrails, and GTM messaging.

Constraints:
- Work in /Users/chrixchange/.openclaw/workspace
- Treat the source files as authoritative for routing behavior, ownership, and operating rules
- Do not invent a different control plane
- Prefer the smallest set of roles needed
- Make ownership explicit
- If delegation is needed, return a dispatch plan with:
  - requested role
  - why that role owns the work
  - exact subtask to send
  - required reviewers/sign-off
- After the dispatch plan, include a merged operator summary with:
  - decisions
  - owners
  - blockers
  - next actions
```

## Limitation reminder

These are not persistent sessions.
They are reusable one-shot ACP role runs that preserve role identity through prompt structure rather than thread-bound session continuity.

## Recommended discipline

- preserve stable labels in prompts and outputs
- keep profile files as the source of truth
- route to the smallest useful set of roles
- require security review for external security claims
- require product review for scope/priority decisions
- let the orchestrator merge outputs instead of dumping raw multi-role fragments
