# SecOpsAI Dashboard

This directory contains the live dashboard app for SecOpsAI.

The dashboard is now intentionally narrow:
- overview of operational state
- findings queue and correlation
- task management
- native triage queue visibility
- helper-backed native SecOpsAI actions
- protected Triage Ops for supply-chain alert review and closure
- Blog Ops workflow dispatch and review queue
- Supabase-backed integration status

It is not a Discord control plane and not a generic multi-agent org shell.

It now also reads native local SecOpsAI state through the helper server:
- triage summary
- pending/applyable triage actions
- latest orchestrator summaries
- latest local findings artifact metadata
- direct native `triage investigate`
- direct native `triage apply-action`
- guarded native `triage close`
- Triage Ops SCM alert investigation, advisory checks, local usage checks, mitigation, and blog draft handoff

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

### Native Triage
- helper readiness
- pending action queue
- recent orchestrator summaries
- findings/orchestrator freshness
- direct native investigate, apply-action, and guarded close controls

### Triage Ops
- supply-chain `SCM-*` alert queue from native SecOpsAI
- one-click investigate, evidence-based verdict, explain verdict, advisory check, local dependency usage check, raw report preview, and mitigation generation
- cross-ecosystem Campaign Research panel for campaign JSON import, package/IOC/source entry, correlation, local usage checks, SOC finding persistence, and review-only campaign blog drafts
- confirmation-gated close as false positive, move to in review, and create blog draft actions
- copyable CLI fallback for every selected alert

Triage Ops uses the local/helper-backed `/api/secopsai/triage-ops/*` endpoints. The browser never runs shell commands directly. Read actions can run through the helper; write actions require `TRIAGE_OPS_ADMIN_TOKEN` or `BLOG_OPS_ADMIN_TOKEN`.

The **Run Evidence Verdict** action is read-only. It scores package-level maliciousness separately from local environment impact so advisory-backed ecosystem threats can remain actionable even when this repo does not currently use the package. The scorer checks advisory/denylist matches, known compromised versions, raw report indicators, scanner rules, local manifest usage, known IOCs, and missing evidence. It returns a recommended analyst note, score breakdown, mitigation actions, and copyable operator commands.

The **Campaign Research** panel is also read-only by default. Use it when several packages, IOCs, publishers, or source reports belong to the same supply-chain campaign. Paste/import campaign JSON or build the campaign in the form, click **Run Campaign Research**, then review the campaign verdict, package verdicts, local environment impact, correlations, IOCs, mitigation, and references. **Persist Findings** and **Create Campaign Blog Draft** are separate protected actions that require the admin token and confirmation. Campaign blog drafts are created as review-only drafts and are never published automatically.

The same panel now includes **Autonomous Discovery** for low-friction campaign intake. Click **Run Discovery** to poll trusted SecOpsAI news/source registries and cached source metadata, extract supply-chain campaign candidates, and show scored leads. Click **Run Autopilot Dry Run** to research high-scoring candidates without writing findings. Use **Promote to Campaign Research** to load a candidate into the editable campaign form. **Add to Watchlist**, **Persist Findings**, and **Create Review-Only Blog Draft** are protected actions and require the Triage Ops admin token.

### Blog Ops
- GitHub Actions-backed security-blog news ingestion
- review queue for generated external-news drafts
- preview of draft body, source links, severity, and status
- edit modal for title, summary, severity, categories, references, and article markdown
- approval-gated approve/reject/needs-review controls
- publish-approved, rebuild-feeds, and deploy buttons

Blog Ops is intentionally protected. The browser calls `/api/blog/*` Worker endpoints, and the Worker dispatches the SecOpsAI `blog-ops.yml` workflow. Operators paste `BLOG_OPS_ADMIN_TOKEN` into the page for write actions; GitHub tokens stay server-side in Cloudflare Pages secrets.

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

Optional `.env` values:
- `SECOPSAI_ROOT`
  - local repo root used by the helper server for native triage/orchestrator state and helper-backed native actions
- `SECOPSAI_DB_PATH`
  - optional SQLite override for testing helper-backed native actions against a copied SecOpsAI database
- `BLOG_OPS_GITHUB_TOKEN`
  - optional local Pages preview token for dispatching the SecOpsAI `blog-ops.yml` workflow
- `BLOG_OPS_ADMIN_TOKEN`
  - local operator token required by write endpoints
- `TRIAGE_OPS_ADMIN_TOKEN`
  - optional local operator token for Triage Ops write endpoints; if omitted, the helper falls back to `BLOG_OPS_ADMIN_TOKEN`

## Cloudflare Pages

For hosted deployment with same-origin backend endpoints, see [CLOUDFLARE_PAGES.md](./CLOUDFLARE_PAGES.md).
