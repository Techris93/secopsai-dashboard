# SecOpsAI Vision Dashboard v1 Task Pack

This task pack contains six ready-to-run ACP one-shot prompts for the first SecOpsAI Vision detections dashboard workstream.

## Roles included
- `product/product-manager`
- `security/threat-detection-engineer`
- `platform/backend-architect`
- `product/ui-designer`
- `security/security-engineer`
- `revenue/content-creator`

## Goal
Design a secure detections dashboard for SecOpsAI Vision that helps analysts review suspicious telemetry from Hermes, Manus, and Zu-computers, define backend/data requirements, establish external security claim guardrails, and draft launch-ready website messaging.

## Files
- `01-product-product-manager.md`
- `02-security-threat-detection-engineer.md`
- `03-platform-backend-architect.md`
- `04-product-ui-designer.md`
- `05-security-security-engineer.md`
- `06-revenue-content-creator.md`

## Usage
Run any file as an ACP one-shot task with:
- `runtime: acp`
- `agentId: codex`
- `mode: run`
- `thread: false`
- `cwd: /Users/chrixchange/.openclaw/workspace`

Or render/adapt prompts with the fallback launcher if needed.

## Suggested execution order
1. Product manager
2. Threat detection engineer
3. Backend architect
4. UI designer
5. Security engineer
6. Content creator

## Review chain
- Product approves scope and positioning
- Security approves claims and trust-boundary language
- Content is drafted only after product/security constraints are clear
