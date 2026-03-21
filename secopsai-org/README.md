# SecOpsAI Org

This folder models SecOpsAI as an OpenClaw-operated company structure.

## How to use this

OpenClaw does not have a native "department" object, so this org is represented with:
- department documents in `departments/`
- agent profile files in `agents/`
- stable session labels using `<department>/<role>` naming

## Naming convention

Use labels like:
- `platform/software-architect`
- `security/threat-detection-engineer`
- `product/product-manager`
- `revenue/content-creator`
- `support/support-responder`
- `ops/finance-tracker`
- `exec/agents-orchestrator`

## Suggested rollout

Start with these first:
- `platform/software-architect`
- `platform/backend-architect`
- `platform/ai-engineer`
- `platform/devops-automator`
- `security/security-engineer`
- `security/threat-detection-engineer`
- `product/product-manager`
- `revenue/content-creator`
- `revenue/outbound-strategist`
- `revenue/sales-engineer`
- `support/support-responder`
- `ops/finance-tracker`
- `exec/agents-orchestrator`

## Session model

For persistent agents, create long-lived sessions and label them with the values above.
Use ACP sessions for coding-heavy roles when you want Codex/Claude Code/Gemini-style harnesses.
Use native subagents for lighter planning, writing, analysis, coordination, and review roles.

## Current operating mode

Right now, the practical working mode is the ACP one-shot fallback documented in:
- `acp-fallback/README.md`
- `acp-fallback/runbook.md`
- `orchestration-runbook.md`
- `adr/0001-acp-one-shot-operating-model.md`

Why: persistent thread-bound sessions are currently unavailable in the active webchat/control-ui surfaces, while ACP one-shot runs are working.
