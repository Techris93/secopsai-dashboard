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
- Evidence: browser verification confirmed `research/inbox`, `research/cases`, `publications/news`, `publications/review`, and `system/automation` update both the URL and visible section state. Legacy `#publications` and `#research/cases` remain valid.
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
- Evidence: `system/automation` now isolates model selection, bridge controls, analysis requests, autonomous triage, and tuning proposals from health and audit views.
- Evidence: Findings rows now expose `Review` as the primary action and place task, investigation, and command-copy actions behind `More`.
- Evidence: System now has a dedicated Automation route and a separate Credentials route that reports readiness without displaying secrets. Work defaults to an Operator queue scope, with an explicit All work escape hatch; Publications separates Original research from External news.
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
