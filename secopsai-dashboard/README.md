# SecOpsAI Dashboard

A lightweight Mission Control dashboard for SecOpsAI.

It is a **control-plane UI**, not the conversation runtime itself.
Use it to:
- monitor agent activity
- manage work across roles
- review findings and correlation hints
- track queued run requests
- manage reusable artifacts
- inspect channel/integration metadata

Live conversations and orchestration should still be handled by **OpenClaw-native orchestrators**.

---

## What this dashboard does

The dashboard provides these main surfaces:

- **Mission Control** — overall operational view
- **Org Map** — role topology and latest activity
- **Agents** — role-based run monitoring
- **Tasks** — Kanban workflow for work items
- **Findings** — findings queue with task/correlation helpers
- **Artifacts** — reusable outputs and approvals
- **Integrations** — routes, queue state, and connectivity info

---

## Current stack

- HTML + Vanilla JS
- Tailwind CSS
- Supabase JS SDK
- Optional local Python helper server
- Optional Discord/local notification helper

Important files:

- `index.html` — dashboard shell
- `app.js` — main UI/state logic
- `styles.css` — layout and styling
- `config.js` — local config values
- `dashboard_server.py` — local helper/proxy server
- `discord_dispatcher.py` — queue/dispatch helper
- `serve-dashboard.sh` — local launcher
- `log-agent-run.html` — manual run logger
- `view-run-output.html` — output viewer
- `secopsai-dashboard-seed.sql` — starter data
- `supabase_migrations/2026-03-23_run_requests.sql` — run request migration

---

## Data model

The dashboard is designed around these Supabase tables:

### Core tables
- `agent_runs` — execution audit log
- `work_items` — Kanban tasks
- `artifacts` — reusable outputs
- `channel_routes` — role/channel metadata
- `dashboard_events` — system events and notifications

### Optional / extended tables
- `run_requests` — queued execution requests from dashboard actions
- `findings` — finding records for security investigations and correlation

The UI degrades gracefully if optional tables are missing.

---

## Main pages

## 1. Mission Control

Use this as the top-level operations view.

Shows:
- active runs
- blocked items
- items in review
- done-today count
- security review count
- recent events
- recent runs
- domain distribution
- external-facing work count
- approved artifact count

Best use:
- daily operator review
- team health/status check
- what is stuck / what needs review

---

## 2. Org Map

Shows the SecOpsAI role topology grouped by department.

Examples:
- `exec/agents-orchestrator`
- `platform/backend-architect`
- `security/security-engineer`
- `product/product-manager`
- `revenue/content-creator`

Useful for:
- seeing which roles are active
- identifying roles never run yet
- generating/copying work briefs for a role

---

## 3. Agents

Shows recent role activity from `agent_runs`.

Includes:
- role
- status
- runtime
- model used
- last task
- last active time

Useful for:
- monitoring which roles are productive
- spotting failures or idle roles
- reviewing execution history quickly

---

## 4. Tasks

A Kanban board over `work_items`.

Statuses:
- `inbox`
- `planned`
- `in_progress`
- `review`
- `blocked`
- `done`

Capabilities:
- create/edit/delete tasks
- drag and drop between statuses
- filter by domain, priority, owner, reviewer
- mark external-facing items
- mark security-review items
- assign suggested owner
- generate a work brief
- queue “Run now” requests

Best use:
- triage work
- assign ownership
- track what needs execution or review

---

## 5. Findings

A findings queue and investigation helper.

Capabilities:
- show findings if `findings` exists
- safe empty-state if it does not
- normalize looser schemas across optional columns
- inspect finding detail/context
- correlate findings to tasks
- correlate findings to run requests
- create investigation tasks directly from findings

Current correlation logic considers:
- linked task IDs
- linked run IDs
- domain hints
- token overlap
- fingerprint/dedupe fields
- security-review/domain boosts

Best use:
- investigation triage
- converting detections into owned work
- seeing what findings already map to active execution

---

## 6. Artifacts

Registry for reusable outputs.

Artifact types include:
- `spec`
- `report`
- `copy`
- `schema`
- `runbook`
- `promoted_output`
- `customer_output`
- `operator_output`
- `other`

Approval states:
- `draft`
- `review`
- `approved`
- `rejected`

Useful for:
- tracking reusable outputs
- reviewing publishability
- distinguishing internal vs operator vs customer outputs

---

## 7. Integrations

Shows integration metadata and queue state.

Includes:
- Supabase connection status
- channel route metadata
- local notification helper info
- `run_requests` queue visibility

For `run_requests`, the UI shows:
- status
- role
- request time
- related work item
- suggested channel
- output/error summary

Useful for:
- checking queue health
- seeing what the dashboard has requested to run
- validating route metadata

---

## How to run locally

## Option A — simple local serve

```bash
cd secopsai-dashboard
./serve-dashboard.sh
```

Default local URL is typically:

```bash
http://127.0.0.1:45680
```

## Option B — Python helper server

If you want the local helper endpoints:

```bash
cd secopsai-dashboard
python3 dashboard_server.py
```

This is useful if you need endpoints like:
- `/api/discord-notify`
- `/api/integration-status`

---

## Configuration

Main config lives in:

- `config.js`
- `.env`
- `.env.example`
- `config.template.js`

Typical required values:
- Supabase URL
- Supabase anon key
- optional helper endpoint config
- optional Discord webhook/helper settings

Important:
- `config.js` is used directly by the browser app
- server-side secrets should stay in `.env` / helper-side code, not client-side JS

---

## Database setup

Use the existing schema/seed files as needed:

```bash
secopsai-dashboard-seed.sql
supabase_migrations/2026-03-23_run_requests.sql
```

Suggested minimum tables to make the dashboard useful:
- `agent_runs`
- `work_items`
- `artifacts`
- `channel_routes`
- `dashboard_events`

Recommended extras:
- `run_requests`
- `findings`

If optional tables are missing, the dashboard should still load with graceful fallback states.

---

## Typical workflows

## A. Triage a new finding

1. Open **Findings**
2. Inspect the finding details
3. Review correlated tasks/run requests
4. Click **Create task**
5. Assign suggested owner
6. Generate brief or queue a run

## B. Move work through execution

1. Create or open a task
2. Set domain / priority / reviewer
3. Assign suggested owner
4. Generate brief
5. Use **Run now** to queue execution
6. Track status in **Integrations → run requests**

## C. Produce reusable operator output

1. Complete work from a task/run
2. Save result as an artifact
3. Mark the correct type:
   - operator_output
   - customer_output
   - promoted_output
4. Set approval state
5. Review later from **Artifacts**

---

## Design rules

This dashboard follows a few core principles:

1. **Control plane, not runtime**
   - use it to manage state and queue work
   - keep real conversations in OpenClaw-native flows

2. **Graceful degradation**
   - optional tables may be absent
   - UI should still load and stay useful

3. **Auditability**
   - task mutations create events and runs
   - work should be explainable after the fact

4. **Human-in-the-loop first**
   - findings become tasks
   - outputs become artifacts
   - approval matters

---

## Recommended next upgrades

If you want to keep productizing this dashboard, the next strong steps are:

1. formal `findings` schema + migration
2. dedicated finding status / assignee workflow
3. stronger evidence and IOC rendering
4. direct artifact linkage from findings
5. richer run request lifecycle controls
6. finding-to-incident grouping
7. real-time updates / subscriptions

---

## Notes

- This repo is best treated as the **SecOpsAI Mission Control UI**.
- It complements SecOpsAI product workflows instead of replacing OpenClaw orchestration.
- The highest-value product fit is: **findings → correlation → task → run → artifact**.

