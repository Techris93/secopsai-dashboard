# UI Designer Output

## IA overview
- Primary layout: findings queue -> selected finding detail -> supporting metadata/actions
- Design for rapid scanning first, deep inspection second
- Preserve source attribution, severity, confidence, and status at all times

## Queue/list view
- Table/list with sortable columns:
  - severity
  - confidence
  - title
  - source
  - primary entity
  - first seen / last seen
  - status
- Strong visual differentiation for high/critical items
- Dense but readable layout optimized for triage

## Finding detail view
- Header: title, severity, confidence, status, source badges
- Summary panel: why this finding exists and what behavior was observed
- Evidence timeline or stacked evidence cards
- ATT&CK panel with tactic/technique references
- Entity panel for host/user/process/network/file pivots
- Analyst action area for status changes and notes

## Filters/search/actions
- Filters: source, severity, confidence, status, time range
- Search: entity IDs and finding IDs first; avoid broad unsupported search promises
- Actions: acknowledge/investigating, escalate, false positive, resolved
- Keep actions explicit and low-risk; no destructive shortcuts

## Accessibility/responsive requirements
- WCAG AA contrast as baseline
- Keyboard-navigable queue and action controls
- Screen-reader-friendly labels for severity, confidence, and status
- Responsive fallback should preserve triage priority rather than cram every panel onto small screens

## Design-system notes
- Use low visual entropy with intentional color only for severity/state cues
- Source badges should be distinct but not dominant
- Confidence should be shown differently from severity to avoid semantic confusion
- Favor reusable evidence cards and metadata chips over one-off visual treatments

## Handoff guidance for engineering
- Build queue and detail panels as independent components
- Preserve stable empty/loading/error states
- Avoid hiding critical evidence behind deep accordion nesting
- Support source-specific metadata slots so the UI does not break when Hermes, Manus, and Zu-computers expose different fields
