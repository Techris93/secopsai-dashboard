# ADR 0001: Use ACP one-shot orchestration as the current SecOpsAI operating model

## Status
Accepted

## Date
2026-03-21

## Context
SecOpsAI was originally planned around 12 persistent OpenClaw sessions with stable labels like `platform/software-architect` and `security/security-engineer`.

That design is still the preferred target model, but the current OpenClaw surfaces available here do not support the required thread-bound persistence:
- native subagent persistent sessions are blocked because subagent spawning thread hooks are unavailable in the current UI context
- persistent ACP sessions are blocked because thread bindings are unavailable for webchat/control-ui
- ACP one-shot runs are working after enabling the `acpx` backend

We need a practical operating model that preserves the role architecture without waiting on thread-capable surfaces.

## Decision
Adopt **ACP one-shot role execution** as the current SecOpsAI operating model.

This means:
- keep the existing role profiles and stable labels as the conceptual source of truth
- use `exec/agents-orchestrator` as a thin control plane
- invoke role agents as ACP one-shot runs using the role prompt wrappers in `secopsai-org/acp-fallback/prompts/`
- route each task to the smallest role set needed
- produce a single merged output through the orchestrator

## Why this is the best current option
- It works in the current environment today.
- It preserves the org structure and role boundaries.
- It avoids wasting time on thread-binding limitations we cannot currently bypass.
- It can later be upgraded to persistent sessions without redesigning the roles.

## Consequences
### Positive
- SecOpsAI can operate immediately.
- The 12-role structure remains intact.
- ACP harnesses provide strong one-shot execution for role-based work.
- The fallback model is explicit and documented.

### Negative
- No thread-bound continuity per role.
- Reuse comes from prompt wrappers and source profile files, not persistent memory inside each role session.
- Some work may require reloading context that a persistent session would have retained.

## Operating rules
- `exec/agents-orchestrator` is a router, not a specialist.
- Prefer the smallest set of roles needed for each request.
- One decider per workstream; collaborators are advisory unless explicitly assigned ownership.
- Security signs off on external security claims.
- Product signs off on scope and priority.
- Software architect signs off on irreversible architectural changes.
- The orchestrator returns one merged answer with owners, blockers, and next actions.

## Upgrade path
When a thread-capable OpenClaw surface becomes available:
1. keep the same role labels
2. promote the highest-value roles to persistent sessions first
3. preserve the ACP one-shot fallback as a portable backup mode

## Related files
- `../session-spawn-plan.md`
- `../agents/exec/agents-orchestrator.md`
- `../acp-fallback/runbook.md`
- `../acp-fallback/prompts/`
