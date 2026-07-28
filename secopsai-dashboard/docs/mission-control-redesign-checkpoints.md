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
- Acceptance: route labels, metric scopes, research sections, publication queues, and System workspaces are explicit; old links remain compatible.

## Checkpoint 2: Evidence-led research workflow

- Status: in progress
- Goal: present discovery, validation, disclosure, publication, and monitoring as a guided case pipeline.
- Evidence: selected case detail now presents a guarded `Next action` panel that derives its recommendation from pipeline, review, disclosure, and publication state.
- Acceptance: a case shows its current stage, blockers, evidence completeness, automated work, and next permitted action.

## Checkpoint 3: Automation and system boundaries

- Status: in progress
- Goal: move model selection and autonomous triage into a dedicated Automation surface.
- Evidence: `system/automation` now isolates model selection, bridge controls, analysis requests, autonomous triage, and tuning proposals from health and audit views.
- Acceptance: model decisions, guardrails, reversibility, and audit history are understandable without exposing service internals.

## Checkpoint 4: Responsive and accessible console

- Status: in progress
- Goal: remove mobile overflow and improve keyboard, labels, focus, and target sizing.
- Evidence: Chrome verification at `390x844` reported document width equal to viewport width after the table and navigation changes; remaining workspace-button internal truncation is intentional and being refined.
- Acceptance: desktop and 390px viewport checks pass with no horizontal page overflow and no unlabeled visible controls.

## Checkpoint 5: Verification and release

- Status: pending
- Goal: run the complete test suite, browser smoke flows, and document residual risks.
- Acceptance: tests pass, screenshots or DOM evidence are recorded, and the branch is ready for review.
