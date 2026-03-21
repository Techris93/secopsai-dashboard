# SecOpsAI Vision Dashboard v1 — Merged Package

## Executive summary
SecOpsAI Vision v1 should launch as a **triage-first detections dashboard** that helps analysts review suspicious telemetry from Hermes, Manus, and Zu-computers without pretending to be a full SOC platform or autonomous prevention system.

The launchable core is:
- a unified findings queue
- a finding detail view with evidence and source attribution
- severity and confidence indicators
- ATT&CK-aware context where available
- explicit analyst workflow states
- tight claim guardrails for external messaging

## Product definition
### Problem
Analysts need a focused way to review suspicious telemetry across integrated systems without drowning in raw event noise or overpromised automation.

### Primary users
- Security analysts / operators
- Technical leads validating detection quality

### V1 must-have scope
- Unified findings queue
- Finding detail with evidence and rationale
- Source attribution per finding
- Severity + confidence displayed separately
- Filters for source, severity, confidence, status, and time range
- Analyst actions: investigating, escalated, false positive, resolved

### Out of scope
- SOAR / automated response
- Full case management
- Deep reporting/analytics suite
- Full rule authoring UI
- Claims of comprehensive correlation or guaranteed efficacy

## Detection model
### Finding object
- ID, title, summary
- severity
- confidence
- source system(s)
- ATT&CK mapping
- affected entities
- timestamps
- evidence references
- rationale
- workflow state

### Minimum analyst-visible evidence
- event timestamps
- source event references
- host/user/process/network/file identifiers where available
- why the detection fired
- supporting artifacts and pivots
- false-positive cues / known limitations

### Workflow states
- New
- Investigating
- Escalated
- False positive
- Resolved

## Backend and data design
### Architecture assumptions
- Source telemetry varies in shape and quality
- v1 needs normalization plus preserved source-native metadata
- UI should consume finding-centric APIs, not raw event search directly

### Core normalized event schema
- event_id
- source_system
- event_time
- ingest_time
- entity identifiers
- behavior/action fields
- raw_reference
- source_metadata
- normalization_version

### Core finding schema
- finding_id
- title
- summary
- severity
- confidence
- status
- source_systems[]
- primary_entities[]
- attack_tactics[]
- attack_techniques[]
- first_seen / last_seen
- evidence_refs[]
- rationale
- recommended_next_step

### Core API surface
- `GET /findings`
- `GET /findings/:id`
- `GET /findings/:id/evidence`
- `POST /findings/:id/status`
- `POST /findings/:id/notes`

### Key backend risks
- ingest lag during event bursts
- noisy/duplicate findings from weak correlation
- over-normalization hiding analyst-important source nuance
- expensive broad search too early in v1

## UX specification
### Information architecture
Use a tri-pane or triage-oriented layout:
1. findings queue
2. selected finding summary and evidence
3. metadata, ATT&CK context, and analyst actions

### Queue view
Show:
- severity
- confidence
- title
- source
- primary entity
- timestamps
- status

### Detail view
Include:
- summary of suspicious behavior
- evidence timeline/cards
- ATT&CK panel
- entity pivots
- analyst actions and notes

### UX principles
- low visual entropy
- strong severity cues without chaos
- confidence distinct from severity
- source attribution always visible
- keyboard and accessibility support from day one

## Security guardrails
### Trust boundaries
- telemetry is untrusted at ingest
- normalization/correlation are trust-transition points
- dashboard evidence may contain sensitive operational data
- website claims must be treated separately from internal product intent

### Access and audit requirements
- role-based access
- least privilege for detailed evidence views
- auditability for status changes and notes
- separation between read and admin/config functions

### Approved claims
- Helps analysts review suspicious telemetry across integrated sources
- Surfaces findings with supporting evidence and triage context
- Improves workflow for reviewing suspicious activity
- Provides visibility into suspicious telemetry from connected systems

### Prohibited claims
- Stops attacks automatically
- Guarantees malware detection
- Eliminates false positives
- Provides complete coverage
- Prevents all exfiltration
- Any unsupported accuracy or autonomy claim

## Launch-ready website messaging
### Headline
See suspicious telemetry clearly, before it becomes operational chaos.

### Subhead
SecOpsAI Vision gives analysts a focused detections dashboard for reviewing suspicious activity from Hermes, Manus, and Zu-computers with evidence, source context, and triage-ready workflows.

### Key value bullets
- Review suspicious findings from multiple integrated sources in one triage-first workspace
- Understand why a finding matters with supporting evidence and source context
- Prioritize faster with visible severity, confidence, and workflow states
- Move from raw telemetry noise to structured finding review
- Keep triage decisions grounded in evidence instead of generic alert streams

### How it works
SecOpsAI Vision ingests suspicious telemetry from connected systems, organizes it into structured findings, and presents analysts with the context they need to review, prioritize, and escalate the right issues faster.

### CTA
Request a walkthrough of the SecOpsAI Vision detections dashboard.

## Open decisions before launch
- final retention window for searchable analyst-visible data
- minimum audit trail requirements for notes and status changes
- exact scope of source-specific metadata shown in evidence views
- whether entity pivoting ships in v1 or v1.1
- measured proof, if any, for stronger performance/detection claims

## Recommended next actions
1. Convert this merged package into a short PRD + UI spec + API spec set
2. Define the canonical finding and evidence schemas
3. Build the queue/detail UI skeleton first
4. Add status transitions and audit trail
5. Review all copy through product + security before external use
