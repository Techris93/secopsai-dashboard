# Mission Control Redesign Checkpoints

This ledger records the product redesign in verified, reversible checkpoints.

## Checkpoint 0: Baseline and scope

- Status: complete
- Evidence: signed-in Chrome walkthrough on 2026-07-29; existing JavaScript, Python, and browser-facing tests inspected.
- Findings: metric scopes are ambiguous; Research and Publications combine several workflows; System exposes implementation controls; mobile tables overflow; several controls lack accessible labels.
- Safety: no scans, closures, disclosures, uploads, collector runs, or publications were triggered.

## Checkpoint 1: Operator information architecture

- Status: complete
- Goal: make each operator destination answer one question and give it one primary next action.
- Evidence: browser verification confirmed `research/inbox`, `research/cases`, `publications/news`, `publications/review`, and `automation` update both the URL and visible section state. Legacy `#publications` and `#research/cases` remain valid.
- Evidence: Findings and Overview cards now label whether counts come from current filters, Core canonical records, dashboard records, or the local Core triage artifact.
- Acceptance: route labels, metric scopes, research sections, publication queues, and System workspaces are explicit; old links remain compatible.

## Checkpoint 2: Evidence-led research workflow

- Status: complete
- Goal: present discovery, validation, disclosure, publication, and monitoring as a guided case pipeline.
- Evidence: selected case detail now presents a guarded `Next action` panel that derives its recommendation from pipeline, review, disclosure, and publication state.
- Evidence: the case workspace now has explicit route views for Inbox, Cases, Watchlists, Disclosure, and Sandbox jobs. The selected case detail exposes the next permitted action rather than requiring the operator to infer it from a long page.
- Acceptance: a case shows its current stage, blockers, evidence completeness, automated work, and next permitted action.

## Checkpoint 3: Automation and system boundaries

- Status: complete
- Goal: move model selection and autonomous triage into a dedicated Automation surface.
- Evidence: the standalone `automation` page owns model selection, bridge controls, analysis requests, autonomous triage, investigation pipelines, and tuning proposals. System owns only health, integrations, credentials, and audit history.
- Evidence: Findings rows now expose `Review` as the primary action and place task, investigation, and command-copy actions behind `More`.
- Evidence: Automation and System are independent primary destinations. System has a Credentials route that reports readiness without displaying secrets. Work defaults to an Operator queue scope, with an explicit All work escape hatch; Publications separates Original research from External news.
- Acceptance: model decisions, guardrails, reversibility, and audit history are understandable without exposing service internals.

## Checkpoint 4: Responsive and accessible console

- Status: complete
- Goal: remove mobile overflow and improve keyboard, labels, focus, and target sizing.
- Evidence: Chrome verification at `390x844` reported document width equal to viewport width after the table and navigation changes; remaining workspace-button internal truncation is intentional and being refined.
- Evidence: responsive CSS keeps tables inside scroll containers, preserves 44px control targets, stacks credentials and publication filters on narrow screens, and keeps context navigation horizontally usable.
- Acceptance: desktop and 390px viewport checks pass with no horizontal page overflow and no unlabeled visible controls.

## Checkpoint 5: Verification and release

- Status: complete
- Goal: run the complete test suite, browser smoke flows, and document residual risks.
- Evidence: `npm test` passed, `PYTHONPATH=. pytest -q tests` passed with 69 tests and 13 subtests, `node --check app.js` passed, and `git diff --check` passed. Static contract coverage now includes work scope, publication stream filters, and credential readiness.
- Evidence: `npm run build` passed (`npm run check`), and a live signed-in Chrome route check previously verified Research, Publications, and System route isolation. A later forced browser reload hit the existing Supabase key-ring/session recovery error, so no post-reload live assertion is claimed.
- Acceptance: tests pass, screenshots or DOM evidence are recorded, and the branch is ready for review.

## Checkpoint 6: Complete audit implementation

- Status: complete
- Goal: finish the remaining structural recommendations from the professional audit instead of treating the first hardening pass as the complete redesign.
- Implemented: route-specific asset workspaces (`assets/inventory`, `assets/changes`, `assets/sensors`, `assets/schedules`, `assets/wifi`), a selectable asset detail view with services and history, dedicated Research Inbox, Disclosure, and Sandbox queue panels, Original Research and Advisories publication lanes, an operator queue on Overview, and a top-level Automation destination.
- Verification: `node --check app.js`, `npm test`, `npm run build`, `PYTHONPATH=. pytest -q tests` (69 passed, 13 subtests), and `git diff --check` pass. Signed-in Chrome smoke checks verified Research Inbox, Original Research, Automation, and asset Changes routes; route-specific panels rendered with no ambiguous fallback copy. Mobile card styling keeps data-dense Findings and Assets usable at narrow widths. The research case now exposes an explicit eight-stage stepper: Lead, Safe intake, Analysis, Verdict, Disclosure, Publication, Detections, Monitoring.
- Acceptance: operator queues are visible from Overview; Research, Publications, Assets, and System have real route-specific workspaces; the dashboard keeps model/credential controls separate from operational work; mobile tables have card alternatives; and the complete test/release checks pass.

## Checkpoint 7: Audit closure

- Status: complete
- Goal: close every residual item from the signed-in professional walkthrough.
- Implemented: independent visible Research workspaces for Inbox, Cases, Campaigns, Watchlists, Disclosure, and Sandbox; durable candidate-promotion policy with preview and audited draft-only application; isolated Original Research, Advisory, and External News approval queues; a fixed finding-review drawer and saved finding views; operator-only work filtering; removal of implementation activity from Overview; removal of CLI fallbacks from normal finding and health workflows; explicit scope on System metrics; automatic mobile-card labels for every dynamic data table; keyboard focus treatment and 44px control targets.
- Safety: automatic promotion creates draft investigations only. False-positive closures, external sandbox submission, disclosure delivery, attribution, irreversible response, and final publication retain their existing approval boundaries.
- Verification: dashboard JavaScript, contract tests, production build, Python gateway tests, Core's complete 453-test suite, diff checks, and a 390×844 browser check pass. The browser reported no horizontal overflow, no visible unlabeled controls, and no visible controls under 40px. Signed-in route behavior remains covered by the route contract and the earlier authenticated smoke session; this final browser session reached the enforced sign-in boundary and did not bypass authentication.

## Checkpoint 8: Navigation ownership correction

- Status: complete
- Goal: ensure that every primary and secondary navigation control owns a real, reload-stable operator destination.
- Implemented: Automation is an independent Administration page and route; System owns only health, integrations, credentials, and audit history; Work is restored to primary navigation; Global Coverage is no longer overwritten by the Research tab router; Findings and Supply Chain share a consistent two-destination subnavigation; placeholder Work, Findings, Supply Chain, and Coverage tabs that did not change content were removed.
- Verification: contract tests assert distinct Automation and System DOM ownership, reject the former `system/automation` alias, and reject placeholder secondary links. Browser route checks confirmed `#automation` selects `page-automation`, `#system/credentials` selects only the credentials section in `page-integrations`, and `#research/coverage` selects `page-coverage` after direct navigation.
- Acceptance: Automation and System cannot appear active together; deep links resolve to the same page before and after reload; the legacy `system/automation` bookmark resolves to standalone Automation; every visible secondary tab changes destination; the Health shortcut always opens System Health.

## Checkpoint 9: Nested route navigation

- Status: complete
- Goal: keep primary sections and their secondary views in one visible navigation
  tree so operators do not need to search the top bar for the next workspace.
- Implemented: the active sidebar section now expands a nested `Views` group
  for route-level destinations and an `In this view` group for direct panel
  anchors. Research now owns Inbox, Cases, Campaigns, Watchlists, Global
  Coverage, Disclosure, Sandbox Jobs, and Resolved by Agents. System now owns
  Health, Integrations, Credentials, and Audit Log. Findings, Assets,
  Publications, and Global Coverage use the same pattern. The top bar no longer
  renders a second clickable navigation row; it shows workspace context only.
- Verification: route contract tests, JavaScript syntax checks, production
  build, Python dashboard tests, and diff checks pass. Route buttons retain
  reload-stable hashes and direct panel buttons scroll only to visible targets.
- Acceptance: clicking a primary section reveals all of its secondary routes
  directly beneath it; Research and System no longer require top-bar tab clicks;
  mobile navigation closes after a nested destination is selected.

## Checkpoint 10: Collapsible navigation hierarchy

- Status: complete
- Goal: make the nested sidebar behave like a predictable enterprise disclosure
  tree instead of a permanently expanded list.
- Implemented: selecting the active primary section collapses its route and
  panel children; selecting it again restores them. Navigating to another
  primary section expands that destination. Refresh rendering preserves the
  current collapse choice, and the parent exposes a chevron plus synchronized
  `aria-expanded` and `aria-controls` attributes.
- Verification: contract tests cover the toggle state, hidden child container,
  event binding, and disclosure affordance. Signed-in Chrome verification covers
  both Research and System after the production checks pass.
- Acceptance: secondary views exist only beneath their owner, no top-row tab is
  required, active parents toggle in one click, and keyboard and assistive
  technology users receive the same expanded/collapsed state.

## Checkpoint 11: Research navigation and manual sandbox handoff

- Status: complete
- Goal: remove two misleading operator states and provide a safe dynamic-analysis
  path while automated Tria.ge access is pending.
- Implemented: primary Research navigation now starts at the top of the page;
  secondary Research routes still move to their named workspaces. Running daily
  steps display **In progress**, never the fallback **Completed**, and unfinished
  steps no longer show their start time as a finish time. An approved sandbox
  request can prepare one hash-verified local download, and a separate form
  records only a sanitized Tria.ge report reference, score, and reviewed summary.
- Safety: the manual handoff requires the protected action token, an approved
  request, explicit public-submission acknowledgment, an exact attached hash,
  owner-only staging, no-store response headers, and immediate staging cleanup.
  The download does not submit or execute the sample.
- Acceptance: a primary Research click lands at the page header; status and result
  columns cannot contradict each other; pending API access does not block a
  fully audited manual sandbox workflow; raw sandbox results and quarantine paths
  never enter browser state, cloud storage, or AI context.

## Checkpoint 12: Decision-first operations and automation visibility

- Status: complete
- Goal: let an operator answer three questions immediately after sign-in: what
  needs me now, what SecOpsAI is already doing, and what remains intentionally
  approval-gated.
- Audit scope: every primary destination and secondary route was reviewed in a
  signed-in Chrome session: Today, Findings, Assets, Work, all Research and
  Publications views, Models, Alert review, Investigations, Research pipeline,
  Learning, Jobs, Health, Integrations, Credentials, Audit log, and all
  Enterprise views.
- Implemented: Overview is now **Today** and leads with one evidence-backed
  decision, three ordered follow-up decisions, a concise automation pipeline,
  and a health strip. Workload totals, run history, and research queues remain
  available under **More operational detail**, but no longer compete with the
  operator's next action.
- Implemented: every workspace now receives a compact **Recommended next step**
  card that distinguishes the action SecOpsAI can perform from the decision a
  person must make. Findings present priority, detection confidence,
  maliciousness, and local exposure as separate fields, then collapse the full
  technical record beneath the decision card.
- Redundancy removed: the duplicate Work reviewer filter was removed, repeated
  first-view finding metrics were reduced to four decision-oriented counts, and
  existing safe automation was surfaced instead of adding a competing
  autopilot.
- Automation policy: the existing six-hour daily workflow, guarded alert review,
  guarded evidence investigations, and guarded read-only specialist routing are
  treated as the canonical safe automation path. Maximum safe routine automation
  is visible on Today. Verdicts, containment, sandbox submission, disclosure,
  publication, deployment, destructive changes, model fallback, and spending or
  concurrency increases remain explicit operator decisions.
- Prioritization: Today reports model blockage first, followed by missing safe
  automation configuration, degraded collection, pending approvals, blocked
  work, validation blockers, open findings, and active backlog. A queued workload
  is not labeled blocked while a worker is running; model blockage requires a
  non-empty queue, zero running work, and a selected model that is not ready.
- Operational limitation: a large queue is a throughput and backpressure signal,
  not permission to silently change the selected model, enable fallback, raise
  concurrency, or increase model spend. Today points the operator to model
  routing or Jobs while preserving the persisted routing policy.
- Safety: no automatic verdict, containment, external submission, disclosure,
  publication, deployment, or destructive mutation was introduced. Browser
  controls continue to use typed allowlisted helper operations.
- Verification: static contracts assert unique DOM IDs, one reviewer filter,
  action wiring, decision-first surfaces, route guidance, model refresh before a
  routing decision, explicit safety-boundary copy, and cache-key updates. Signed-
  in Chrome verification covers Today, model-routing navigation, representative
  workspaces, and desktop/mobile visual behavior.
- Acceptance: a new operator sees one prioritized decision rather than a wall of
  metrics, can identify automation already in progress, can reach the right
  workspace in one action, and is never told that a model score or queue count is
  a final security verdict.
