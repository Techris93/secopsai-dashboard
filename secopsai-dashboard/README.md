# SecOpsAI Dashboard

This directory contains the live dashboard app for SecOpsAI.

The dashboard is now intentionally narrow:
- overview of operational state
- findings queue and correlation
- task management
- run-request visibility
- Supabase-backed integration status

It is not a Discord control plane and not a generic multi-agent org shell.

## Pages

### Overview
- active runs
- blocked items
- in-review items
- done today
- security-review count
- recent dashboard events
- recent runs
- open findings shortcut

### Tasks
- Kanban board over `work_items`
- task create/edit/delete
- owner/reviewer assignment
- work brief generation
- queueing into `run_requests`

### Findings
- `findings` table visibility when present
- finding detail and correlation
- create a task directly from a finding

### Integrations
- Supabase readiness
- local helper readiness
- `run_requests` queue state
- `channel_routes` metadata

## Runtime split

- `secopsai` owns detection, triage, orchestrator logic, and policy decisions
- dashboard owns observability, state editing, and queue visibility

## Files

- `index.html` — dashboard shell
- `app.js` — UI logic
- `styles.css` — styling
- `config.template.js` — generated config template
- `generate-config.py` — config generator
- `dashboard_server.py` — local helper server
- `serve-dashboard.sh` — simple local serve
- `start-local-dashboard-stack.sh` — local dashboard bootstrap

## Deprecated and removed

These older dashboard-era components are no longer part of the active product direction:
- Discord dispatcher runtime
- direct dashboard-side Discord webhook testing
- Paperclip setup
- Org Map / Agents / Artifacts navigation

## Local usage

```bash
cp .env.example .env
python3 generate-config.py
./start-local-dashboard-stack.sh
```
