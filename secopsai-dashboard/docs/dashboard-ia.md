# SecOpsAI Console Information Architecture

This document defines the operator-facing structure for the SecOpsAI dashboard.
It is the product contract for the staged frontend migration.

## Canonical navigation

| Route | Product area | Existing implementation preserved |
| --- | --- | --- |
| `#overview` | Overview | Mission Control metrics, events, and runs |
| `#findings` | Findings | Core/dashboard finding queue and correlation |
| `#findings/supply-chain` | Supply-chain findings | Existing Triage Ops evidence and response workflow |
| `#assets` | Assets | Edge inventory, sensors, schedules, jobs, and graph changes |
| `#work` | Work | Existing task board and work-item persistence |
| `#system` | System | Native triage, helper readiness, sessions, and integrations |
| `#research/cases` | Research | Research cases, evidence, IOCs, disclosure, and publication handoff |
| `#publications` | Publications | Blog Ops review, approval, staging, and deployment |
| `#help` | Help | Existing operator guide and contextual documentation |

The route layer is intentionally implemented before a framework migration. It
keeps the existing backend and Cloudflare Pages deployment stable while allowing
each page to be replaced by a typed component later.

## Object boundaries

- An **alert** is a machine-generated signal.
- A **finding** is the canonical security issue that can be triaged.
- A **task** is human-owned remediation or review work.
- An **investigation** is a run or analyst session that produces evidence.
- A **research case** is a durable, evidence-led investigation.
- An **asset** is an observed host, service, sensor, package, or network entity.
- A **publication** is approved editorial output.
- A **run/action** is an execution and audit record.

These terms must remain distinct in labels, APIs, links, and audit records.

## Interaction rules

1. Overview answers “what needs attention?” and links to the authoritative record.
2. Findings answers “what is the security issue and what is its evidence?”
3. Work answers “who owns the next action and what is its state?”
4. Assets answers “what changed in the environment?”
5. Research answers “does this lead deserve a durable investigation?”
6. Publications answers “is this safe and approved to share publicly?”
7. System answers “can I trust the integrations and recover from failure?”

Protected writes remain token/capability-gated and must surface scope, impact,
confirmation, and audit context. Read-only evidence and inventory actions may
remain one click away.

## Frontend migration boundaries

The current vanilla frontend is a supported production surface during the
migration. Keep `dashboard_server.py`, `_worker.js`, Supabase policies, and
existing API routes stable. New screens should use the shared shell, route map,
context navigation, command palette, help drawer, toast feedback, and explicit
loading/empty/error/degraded states. Remove legacy renderers only after their
route has parity tests and responsive/a11y coverage.

## Acceptance checks

- Every old page has a canonical destination in the table above.
- Browser hash routes restore the selected page and support back/forward.
- Supply-chain functionality is reachable from Findings without a duplicate
  top-level navigation entry.
- Native actions are reachable from Work/System without a second triage product.
- Research and Publications remain separate because evidence preservation and
  public editorial approval have different safety requirements.
- The page never implies that stale, unavailable, or demo data is live data.
- The shell remains usable at desktop, tablet, and 390px mobile widths.
