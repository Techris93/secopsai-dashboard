# SecOpsAI Orchestration Runbook

## Purpose
This runbook defines how SecOpsAI should operate right now using the working ACP one-shot fallback model.

Operator routing reference:
- `dispatch-matrix.md`

## Current model
- Control plane: `exec/agents-orchestrator`
- Specialist execution: ACP one-shot runs
- Role source of truth: `agents/<department>/<role>.md`
- Prompt wrappers: `acp-fallback/prompts/*.md`

## Core loop
`intake -> classify -> choose smallest agent set -> dispatch -> collect -> resolve conflicts -> synthesize final output`

## Orchestrator rules
- Do not do specialist work when routing is better.
- Prefer the smallest set of roles needed.
- Make ownership explicit for every deliverable.
- Keep one decider per workstream.
- Return one merged output with owners, blockers, and next actions.

## Role ownership map
### Scope and priority
- Primary: `product/product-manager`

### Cross-system architecture and trade-offs
- Primary: `platform/software-architect`

### Backend and implementation design
- Primary:
  - `platform/backend-architect`
  - `platform/ai-engineer`
  - `platform/devops-automator`

### Security validation and external security claims
- Primary: `security/security-engineer`

### Detection content, ATT&CK coverage, and threat-hunting logic
- Primary: `security/threat-detection-engineer`

### UX and product interface quality
- Primary: `product/ui-designer`

### GTM and revenue outputs
- Primary:
  - `revenue/content-creator`
  - `revenue/outbound-strategist`
  - `revenue/sales-engineer`

### Inbound issues and support triage
- Primary: `support/support-responder`

## Routing rules by request type
### Product/build request
Route to:
- `product/product-manager`
- relevant `platform/*`
- `security/security-engineer` if trust boundaries change

### Security feature or security claim
Route to:
- `security/security-engineer` first
- then relevant `platform/*`
- then `revenue/*` only if the output becomes external-facing

### Detection work
Route to:
- `security/threat-detection-engineer`
- `platform/backend-architect`
- `product/product-manager` if findings UX or user workflow changes

### Customer issue
Route to:
- `support/support-responder` first
- then relevant `platform/*`, `security/*`, or `product/*`

### Revenue artifact
Route to:
- one of:
  - `revenue/content-creator`
  - `revenue/outbound-strategist`
  - `revenue/sales-engineer`
- plus mandatory validation from:
  - `product/product-manager` for positioning/scope
  - `security/security-engineer` for security claims

## Sign-off rules
- Product signs off on scope and priority.
- Software architect signs off on irreversible architecture changes.
- Security signs off on external security claims.
- Support owns customer-facing triage language unless escalated.

## Execution pattern
For each delegated role run:
1. select the corresponding prompt wrapper from `acp-fallback/prompts/`
2. replace `{{TASK}}` with the concrete assignment
3. run it as an ACP one-shot session
4. collect result
5. reconcile conflicts centrally in the orchestrator

## Example dispatch set
Request: “Design a secure detections dashboard and prepare launch messaging.”

Suggested routing:
- `product/product-manager` — scope and priorities
- `product/ui-designer` — dashboard UX
- `security/threat-detection-engineer` — detection semantics and workflows
- `platform/backend-architect` — backend/data design
- `security/security-engineer` — trust and security review
- `revenue/content-creator` — launch messaging after product/security validation

## Minimal operating discipline
- Do not wake all roles by default.
- Avoid duplicate ownership.
- Use advisory collaborators only when they add real value.
- Summaries should separate:
  - decisions
  - owners
  - blockers
  - next actions

## Future upgrade
When persistent thread-capable sessions become available, preserve this routing model and swap the execution layer from ACP one-shot runs to persistent labeled sessions.
