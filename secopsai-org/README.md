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
