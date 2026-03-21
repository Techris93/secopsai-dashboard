# Product Manager Output

## Problem
SecOpsAI Vision needs a focused analyst-facing detections dashboard that turns suspicious telemetry from Hermes, Manus, and Zu-computers into triageable findings instead of raw event noise.

## Users
- Primary: security analysts / operators reviewing suspicious activity
- Secondary: technical leads validating detection quality and prioritization
- Tertiary: product/security stakeholders using the dashboard to explain workflow value

## V1 scope
- Unified findings queue across Hermes, Manus, and Zu-computers
- Finding detail view with supporting evidence and source attribution
- Severity and confidence indicators
- ATT&CK-aligned technique/context display where available
- Filters for source, severity, status, time range, and confidence
- Analyst workflow states: new, investigating, escalated, false positive, resolved
- Minimal analyst notes / disposition support

## Out of scope
- Full SOAR / automated response
- Broad case management platform
- Guaranteed multi-source correlation for every finding
- Complex reporting/analytics dashboards
- Advanced custom rule authoring in the UI
- Executive-facing KPI reporting

## Success metrics
- Analysts can triage a finding from queue to disposition in a materially shorter time than raw log review
- First-launch users can understand source, evidence, and recommended action without extra tooling for common cases
- High-priority findings are visually distinguishable within seconds
- Low-friction workflow for marking false positives and escalations

## Risks/assumptions
- Telemetry quality and field consistency may vary across Hermes, Manus, and Zu-computers
- ATT&CK mapping may be partial in early iterations
- Over-scoping the dashboard into a full SOC platform would slow launch and weaken clarity
- External messaging may drift into overclaiming unless security signs off tightly

## Product decisions for downstream teams
- Treat v1 as a triage-first product, not an all-in-one operations console
- Preserve source attribution on every finding
- Optimize for speed, clarity, and analyst confidence over feature breadth
- Require product review for any launch copy that implies automation, coverage completeness, or guaranteed outcomes
