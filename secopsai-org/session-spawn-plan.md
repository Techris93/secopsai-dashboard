# SecOpsAI Session Spawn Plan

This file defines the first 12 persistent OpenClaw agent sessions to run as the initial SecOpsAI operating team.

## Principles
- Use stable labels in the form `<department>/<role>`
- Use `mode: session` for persistence
- Use native `subagent` runtime for planning, analysis, writing, support, and coordination roles
- ACP can be introduced later for coding-heavy roles if you want dedicated Codex/Claude/Gemini harnesses
- Keep the first wave small enough to coordinate well

## First 12 persistent sessions

### Platform Engineering
1. `platform/software-architect`
   - Runtime: subagent
   - Purpose: architecture and ADRs
2. `platform/backend-architect`
   - Runtime: subagent
   - Purpose: backend system design and APIs
3. `platform/ai-engineer`
   - Runtime: subagent
   - Purpose: AI workflows, model integration, evals
4. `platform/devops-automator`
   - Runtime: subagent
   - Purpose: CI/CD, infrastructure, release safety

### Detection & Security Research
5. `security/security-engineer`
   - Runtime: subagent
   - Purpose: threat modeling, appsec review, secure SDLC
6. `security/threat-detection-engineer`
   - Runtime: subagent
   - Purpose: detections, ATT&CK coverage, threat hunting

### Product & Design
7. `product/product-manager`
   - Runtime: subagent
   - Purpose: roadmap, priorities, product decisions
8. `product/ui-designer`
   - Runtime: subagent
   - Purpose: findings/triage UX and product interface quality

### Revenue
9. `revenue/content-creator`
   - Runtime: subagent
   - Purpose: market education, website/blog/social copy
10. `revenue/outbound-strategist`
   - Runtime: subagent
   - Purpose: ICP, outbound messaging, qualified pipeline
11. `revenue/sales-engineer`
   - Runtime: subagent
   - Purpose: demos, technical qualification, POCs

### Support / Ops / Coordination
12. `support/support-responder`
   - Runtime: subagent
   - Purpose: issue triage and customer-facing support

## Orchestrator
Optional but strongly recommended:
- `exec/agents-orchestrator`
- Use as the routing/control layer over the 12 persistent sessions

## Suggested next wave
- `ops/finance-tracker`
- `platform/sre`
- `platform/technical-writer`
- `security/compliance-auditor`
- `revenue/linkedin-content-creator`
- `ops/legal-compliance-checker`
