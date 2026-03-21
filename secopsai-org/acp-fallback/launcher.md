# SecOpsAI Fallback Launcher

## Purpose
Generate a ready-to-run prompt for any SecOpsAI role using the ACP one-shot fallback model.

## Script
`launch-role.sh`

## Usage
```bash
secopsai-org/acp-fallback/launch-role.sh <department/role> <task...>
```

Example:
```bash
secopsai-org/acp-fallback/launch-role.sh \
  platform/software-architect \
  "Propose a minimal orchestrator design for the first 12 roles"
```

## What it does
- maps the stable role label to the matching prompt wrapper under `prompts/`
- injects your task into `{{TASK}}`
- prints the final prompt you can use for an ACP one-shot run

## Supported roles
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

## Preferred ACP agent
Default:
- `codex`

Override with:
```bash
SECOPSAI_ACP_AGENT=claude secopsai-org/acp-fallback/launch-role.sh ...
```

## Execution note
The launcher prints the final role prompt. Use that prompt with an ACP one-shot run in an agent/tooling context using:
- `runtime: acp`
- `agentId: <preferred agent>`
- `mode: run`
- `thread: false`

This keeps the launcher simple and portable even when direct thread-bound ACP execution is unavailable from the current UI surface.
