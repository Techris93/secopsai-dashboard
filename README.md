# SecOpsAI Dashboard

SecOpsAI Dashboard is a lightweight control surface for the current SecOpsAI product.

It is focused on:
- findings visibility
- triage task management
- native triage queue visibility
- helper-backed native investigate/apply-action controls
- Supabase-backed operational state

It is not the core execution runtime. Native SecOpsAI and OpenClaw still own investigation, orchestration, and outbound operator messaging, but the local helper can now invoke selected native SecOpsAI triage actions directly.

## Current surfaces

- `Overview` — top-level run, blocker, review, and findings posture
- `Tasks` — Kanban workflow for work items
- `Findings` — findings backlog with task correlation
- `Native Triage` — local helper health, pending actions, orchestrator history, and selected native action controls

## What was removed

The dashboard no longer ships the older generic mission-control extras that were not aligned with the current SecOpsAI direction:
- Discord dispatcher runtime
- direct dashboard-side Discord messaging
- Paperclip setup flow
- Org Map / Agents / Artifacts UI surfaces

## Current stack

- HTML + Vanilla JS
- Tailwind CSS
- Supabase JS SDK
- optional local Python helper server for integration status, run-output reads, native triage state, and selected native triage actions

Important files:

- `secopsai-dashboard/index.html`
- `secopsai-dashboard/app.js`
- `secopsai-dashboard/styles.css`
- `secopsai-dashboard/config.template.js`
- `secopsai-dashboard/generate-config.py`
- `secopsai-dashboard/dashboard_server.py`
- `secopsai-dashboard/start-local-dashboard-stack.sh`
- `secopsai-dashboard/serve-dashboard.sh`

## Data model

Primary tables:
- `agent_runs`
- `work_items`
- `dashboard_events`

Optional but supported tables:
- `findings`
- `run_requests`
- `channel_routes`

The UI degrades safely if optional tables are not present yet.

## Local run

```bash
cd secopsai-dashboard
cp .env.example .env
python3 generate-config.py
./start-local-dashboard-stack.sh
```

Then open:

```text
http://127.0.0.1:45680
```

## Product fit

This dashboard now complements the latest `secopsai` repo work:
- native triage workflow
- triage orchestrator
- action queue / apply-action flow
- findings sync into Supabase

The local helper now exposes native SecOpsAI triage state so the dashboard can show:
- local `triage summary`
- pending triage actions from `action_queue.json`
- recent orchestrator summaries under `reports/triage/orchestrator/`
- latest local findings artifact metadata
- direct helper-backed `triage investigate`
- direct helper-backed `triage apply-action`
