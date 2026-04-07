# SecOpsAI Dashboard: Triage Control Mode

The dashboard is a SecOpsAI control surface, not a messaging runtime.

## What it does
- reads and writes Supabase state
- manages task workflow
- shows findings and correlation context
- shows run-request lifecycle state
- exposes a local run-output helper for evidence reads

## What it no longer does
- poll Discord for inbound commands
- dispatch agent work directly over Discord
- act as a generic multi-agent org control plane
- maintain artifact-registry workflow as a primary surface

## Runtime split
- `secopsai` handles findings generation, triage, orchestrator decisions, policy tuning, and action queue logic
- dashboard handles observability, task state, findings visibility, and queue inspection

## Current implication
- direct dashboard-side Discord flows are removed
- local helper endpoints are limited to status and run-output access
- the remaining dashboard pages are `Overview`, `Tasks`, `Findings`, and `Integrations`
