# Dashboard UI Audit

## Scope

This audit focused on the SecOpsAI dashboard frontend, especially **Triage Ops**, Campaign Research, Autonomous Discovery, alert review, action grouping, color contrast, and mobile behavior.

## Findings

- **Mixed theme layers**: older light cards were still used inside the newer dark command-surface theme. This produced low-contrast combinations such as light text on pale cards and muted labels that almost disappeared.
- **Triage Ops hierarchy was inverted**: Campaign Research and Autonomous Discovery appeared before the alert list and selected-alert detail, so advanced workflows overwhelmed the daily SCM triage path.
- **Action grouping was flat**: read-only evidence checks, protected response actions, blog draft creation, and CLI fallback appeared as one long button row.
- **Filters were detached**: filters lived above Campaign Research, visually separated from the alert list they control.
- **Long strings were fragile**: report paths, package names, rationale text, and CLI fallback blocks could dominate the page and reduce scanability.
- **Mobile density was high**: form-heavy Campaign Research content appeared too early in the mobile flow, pushing alert review down the page.

## Redesign Approach

- Make alert triage the primary workspace: summary cards, alert list, and alert review appear before campaign tooling.
- Move Campaign Research and Autonomous Discovery into a collapsed advanced dock.
- Place filters inside the Supply Chain Alerts panel.
- Split Alert Review into explicit groups: Overview, Evidence, Analyst note, Evidence actions, Response actions, and CLI fallback.
- Normalize Triage Ops and campaign widgets to a dark, high-contrast palette.
- Keep CLI fallback collapsed by default.
- Preserve existing helper routes, token gating, and dashboard behavior.

## Risks

- Collapsing Campaign Research could hide advanced controls from operators who use it often. The dock summary names the capabilities directly and keeps the section one click away.
- CSS overrides are scoped to `#page-triage-ops` to avoid unintended changes across Blog Ops, Tasks, or Findings.
- No backend behavior changed, so security and helper-route regressions should be low risk.

## Acceptance Checks

- Triage Ops text is readable against its background.
- Alert review is easy to scan before taking action.
- Protected actions are still visually distinct and token-gated.
- Campaign Research remains available but no longer dominates the page.
- Mobile layout stacks sections in a sensible order.
