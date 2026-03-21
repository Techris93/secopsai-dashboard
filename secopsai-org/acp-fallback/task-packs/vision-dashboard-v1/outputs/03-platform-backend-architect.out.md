# Backend Architect Output

## Architecture assumptions
- Hermes, Manus, and Zu-computers emit telemetry in differing formats and reliability profiles
- v1 requires normalization plus source-preserving enrichment, not perfect universal schema convergence
- The dashboard consumes finding-centric APIs rather than querying raw telemetry directly
- Triage speed matters more than exhaustive historical exploration in v1

## Normalized event schema
Core normalized fields:
- event_id
- source_system
- event_time
- ingest_time
- entity_type / entity_id
- host
- user
- process
- network indicators
- file indicators
- action / behavior
- raw_reference
- source_metadata (JSON/object)
- normalization_version

## Finding schema
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
- first_seen
- last_seen
- evidence_refs[]
- rationale
- recommended_next_step
- analyst_notes (optional for v1)
- disposition metadata

## API/query surface
- `GET /findings`
  - filter by status, severity, confidence, source, time range, entity
- `GET /findings/:id`
  - full finding details and evidence references
- `GET /findings/:id/evidence`
  - normalized evidence plus source-native metadata
- `POST /findings/:id/status`
  - update analyst workflow state
- `POST /findings/:id/notes`
  - minimal notes / triage comments
- Optional later: entity pivot and saved filter endpoints

## Data lifecycle strategy
- Store normalized events separately from findings
- Findings are derived/curated objects with references back to events
- Retain hot searchable data for recent triage window; archive older raw telemetry separately
- Index for time, status, severity, confidence, source_system, and high-value entity keys
- Keep search/filter design intentionally narrow in v1

## Failure modes / scaling risks
- Event bursts may cause ingest lag and stale findings
- Over-normalization can strip source nuance analysts need
- Correlation pipelines may create noisy or duplicate findings
- Weak entity resolution can break trust in grouped evidence
- Expensive free-text search across raw telemetry can hurt latency if included too early

## Decisions needed from product/security
- Required retention window for analyst-visible data
- Whether analyst notes/audit trail are mandatory at launch
- Sensitivity classification for displayed telemetry and evidence
- Claim boundaries for any language implying “detection,” “coverage,” or “correlation accuracy”
