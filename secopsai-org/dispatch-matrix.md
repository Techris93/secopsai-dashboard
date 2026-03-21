# SecOpsAI Dispatch Matrix

## Purpose

This matrix is the operator reference for routing work in the current SecOpsAI ACP one-shot model.

Use it to decide:
- whether a request can go directly to one role
- when to invoke `exec/agents-orchestrator`
- which role owns the work
- which reviewers/sign-off are required

## Default rule

- **Single clear owner, low ambiguity** -> send directly to the owning role
- **Cross-functional, ambiguous, or externally sensitive** -> start with `exec/agents-orchestrator`
- **External security claims** -> require `security/security-engineer` review
- **Scope, roadmap, or launch priority changes** -> require `product/product-manager` review
- **Irreversible architecture changes** -> require `platform/software-architect` review

## Role quick map

- `platform/software-architect` -> architecture, boundaries, ADRs, trade-offs
- `platform/backend-architect` -> backend systems, APIs, schemas, integrations
- `platform/ai-engineer` -> AI workflows, model integration, evals, inference design
- `platform/devops-automator` -> CI/CD, infra automation, deployment safety, runbooks
- `security/security-engineer` -> appsec, threat modeling, trust boundaries, security claims
- `security/threat-detection-engineer` -> detections, ATT&CK coverage, hunt logic, alert tuning
- `product/product-manager` -> scope, priorities, PRDs, launch framing, success metrics
- `product/ui-designer` -> interface quality, design systems, accessibility, UX specs
- `revenue/content-creator` -> website/blog/social/campaign copy
- `revenue/outbound-strategist` -> ICP, outbound sequences, signal-based prospecting
- `revenue/sales-engineer` -> demos, POCs, technical qualification, buyer-facing technical assets
- `support/support-responder` -> support replies, triage, escalation summaries, recurring issue patterns
- `exec/agents-orchestrator` -> routing, dispatch planning, conflict resolution, merged summaries

## Request routing matrix

| Request type | Start with | Supporting roles | Required review/sign-off | Notes |
|---|---|---|---|---|
| Product idea or feature definition | `product/product-manager` | `platform/software-architect`, relevant `platform/*`, `product/ui-designer` | Product | Use orchestrator if more than 2 specialist roles are needed |
| Architecture proposal or ADR | `platform/software-architect` | `platform/backend-architect`, `security/security-engineer`, `product/product-manager` | Software architect | Use for irreversible or high-cost decisions |
| Backend/API/data model design | `platform/backend-architect` | `platform/software-architect`, `platform/devops-automator`, `security/security-engineer` | Backend architect; software architect if architecture shifts | Add product review if user-facing scope changes |
| AI feature design or eval plan | `platform/ai-engineer` | `product/product-manager`, `security/security-engineer`, `platform/devops-automator` | AI engineer; product if roadmap impact | Add software architect if platform boundaries change |
| Infra, CI/CD, deployment, reliability | `platform/devops-automator` | `platform/backend-architect`, `security/security-engineer` | DevOps automator | Preserve blocking security gates |
| Security review or threat model | `security/security-engineer` | relevant `platform/*`, `product/product-manager` | Security engineer | Required before external security claims |
| Detection rule design / ATT&CK coverage / hunt plan | `security/threat-detection-engineer` | `platform/backend-architect`, `product/product-manager` | Threat detection engineer | Add security engineer if trust/security posture claims are made |
| UX redesign / dashboard / triage flow | `product/ui-designer` | `product/product-manager`, relevant `platform/*`, `security/threat-detection-engineer` | Product manager for scope | Use orchestrator if detections + backend + launch all move together |
| Launch messaging / blog / website copy | `revenue/content-creator` | `product/product-manager`, `security/security-engineer` | Product + Security | Never publish unvalidated security claims |
| Outbound campaign / ICP / sequences | `revenue/outbound-strategist` | `revenue/content-creator`, `revenue/sales-engineer`, `product/product-manager` | Product for positioning | Security review if claims mention protection/detection efficacy |
| Demo narrative / POC scope / technical sales support | `revenue/sales-engineer` | `product/product-manager`, `security/security-engineer`, relevant `platform/*` | Sales engineer + Product | Security validates technical security claims |
| Customer issue / support escalation | `support/support-responder` | relevant `platform/*`, `security/*`, `product/*` | Support responder unless escalated | Security joins if incident or sensitive issue |
| Cross-functional launch or initiative | `exec/agents-orchestrator` | whichever smallest set applies | Product, Security, Architect as needed | Preferred starting point for multi-role workstreams |
| Ambiguous request with unclear owner | `exec/agents-orchestrator` | selected by router | depends on selected path | Use dispatch plan first |

## Minimal direct-send rules

Send directly to a specialist when all are true:
1. ownership is obvious
2. the task can be completed by one primary role
3. no external claim approval is needed beyond the normal reviewer
4. no major cross-functional trade-off needs arbitration

Otherwise, use `exec/agents-orchestrator` first.

## Standard reviewer rules

### Product review required when
- scope changes
- roadmap priority changes
- launch framing changes
- trade-offs affect user value or delivery timing

### Security review required when
- a trust boundary changes
- authentication/authorization/data handling changes
- an external security claim is made
- a customer issue may be security-sensitive

### Software architect review required when
- service boundaries change
- architecture becomes harder to reverse
- platform-wide decisions affect multiple systems or teams

## Standard output contract for orchestrated work

Every orchestrated summary should end with:
- **Decisions**
- **Owners**
- **Blockers**
- **Next actions**

## Example dispatch sets

### Example 1: “Design a secure detections dashboard and prepare launch messaging.”
Start with: `exec/agents-orchestrator`

Expected roles:
- `product/product-manager`
- `product/ui-designer`
- `security/threat-detection-engineer`
- `platform/backend-architect`
- `security/security-engineer`
- `revenue/content-creator`

### Example 2: “Write a threat model for the new ingestion API.”
Start with: `security/security-engineer`

Supporting roles:
- `platform/backend-architect`
- `platform/software-architect` if system boundaries change

### Example 3: “Create a blog post about SecOpsAI detections.”
Start with: `revenue/content-creator`

Required review:
- `product/product-manager`
- `security/security-engineer`

### Example 4: “Improve SOC triage UX for noisy detections.”
Start with: `exec/agents-orchestrator`

Likely roles:
- `product/ui-designer`
- `security/threat-detection-engineer`
- `product/product-manager`
- `platform/backend-architect`

## Current operating note

This matrix assumes the **ACP one-shot fallback model** in this surface.
When persistent thread-bound sessions become available, keep the same routing logic and swap only the execution layer.
