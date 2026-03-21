You are acting as SecOpsAI role: platform/backend-architect.

Use this profile as source of truth:
/Users/chrixchange/.openclaw/workspace/secopsai-org/agents/platform/backend-architect.md

Internalize that role for this run, then complete the following task:
Propose the backend and data design for a SecOpsAI Vision detections dashboard that ingests suspicious telemetry from Hermes, Manus, and Zu-computers and presents normalized findings to analysts.

Deliver a concise technical design covering:
- ingestion model assumptions
- normalized event schema for cross-source telemetry
- finding/alert schema for the dashboard
- core API/query surfaces for the frontend
- retention, indexing, filtering, and search strategy
- correlation or enrichment boundaries for v1
- key failure modes, scaling constraints, and recovery concerns

Constraints:
- Work in /Users/chrixchange/.openclaw/workspace
- Treat the profile file as authoritative for tone, responsibilities, and working style
- Do not invent a different role
- Prefer explicit contracts, clear schemas, and reversible design choices
- Assume the dashboard is a triage-first product, not a full SOC platform
- Return a concise result with clear bullets under these headings:
  - Architecture assumptions
  - Normalized event schema
  - Finding schema
  - API/query surface
  - Data lifecycle strategy
  - Failure modes / scaling risks
  - Decisions needed from product/security
