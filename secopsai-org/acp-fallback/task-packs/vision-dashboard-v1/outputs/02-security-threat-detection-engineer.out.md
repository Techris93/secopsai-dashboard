# Threat Detection Engineer Output

## Finding model
- Finding ID
- Title / short behavioral summary
- Source system: Hermes | Manus | Zu-computers
- Severity
- Confidence
- Status / workflow state
- ATT&CK technique/tactic mapping
- Affected entities: host, user, process, network artifact, file, session
- Detection rationale / rule or logic reference
- First seen / last seen timestamps
- Evidence count and evidence summary

## Required evidence fields
- Raw event timestamp(s)
- Source telemetry reference / event IDs
- Entity identifiers (host/user/process/IP/domain/file hash where available)
- Observed behavior summary
- Why this is suspicious
- Supporting artifacts and pivots
- Detection dependencies / telemetry source notes
- False-positive cues or expected benign explanations

## Severity/confidence model
- Severity: informational, low, medium, high, critical
- Confidence: low, medium, high
- Severity reflects potential operational impact
- Confidence reflects detection certainty and evidence quality
- Avoid collapsing severity and confidence into one signal

## ATT&CK and metadata requirements
- Show ATT&CK tactic + technique where available
- Preserve source-specific metadata from Hermes, Manus, and Zu-computers instead of flattening it away
- Maintain false-positive profile and validation status for detection logic
- Track whether a finding is behavior-based, IOC-assisted, or correlation-derived

## Analyst workflow states
- New
- Investigating
- Escalated
- False positive
- Resolved
- Optionally: suppressed/tuned later, but not required in v1

## Blind spots / telemetry risks
- Inconsistent field coverage across the three sources
- Correlation quality may be limited early on
- Incomplete entity resolution can reduce analyst trust
- ATT&CK mapping may be approximate for some detections
- Missing context from upstream sensors can inflate false positives

## Recommendations for backend and UX teams
- Backend should preserve source-native fields alongside normalized fields
- UX should make evidence, source attribution, and confidence rationale visible without extra clicks
- Every finding should expose enough context for a human to judge whether it is noise or escalation-worthy
- Avoid dashboards that optimize for alert count instead of analyst decision quality
