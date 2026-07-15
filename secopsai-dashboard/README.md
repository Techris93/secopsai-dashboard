# SecOpsAI Dashboard

This directory contains the live dashboard app for SecOpsAI.

The dashboard is now intentionally narrow:
- overview of operational state
- findings queue and correlation
- task management
- native triage queue visibility
- helper-backed native SecOpsAI actions
- Hermes Agent telemetry findings when SecOpsAI is refreshed with `--platform hermes`
- protected Triage Ops for supply-chain alert review and closure
- a unified SecOpsAI Edge workspace backed by the canonical Core graph and findings store
- explicit Edge-to-Core sync freshness so operators can distinguish current,
  stale, and never-synced graph context
- durable Research Cases for evidence, IOCs, disclosure, exports, and review-only publication handoff
- Blog Ops workflow dispatch and review queue
- built-in operator guide for dashboard click paths and safety rules
- Supabase-backed integration status

It is not a Discord control plane and not a generic multi-agent org shell.

## Operator Authentication

Mission Control is invitation-only by default. The browser restores a Supabase
Auth session before it loads any operational table, and provides sign-in,
sign-out, reset-link, and recovered-password flows. Sensor, Edge integration,
Blog Ops, and Triage Ops credentials are separate credentials and cannot sign
in to the dashboard.

Apply `supabase_migrations/2026-07-13_authenticated_pilot.sql` before enabling a
hosted pilot. The migration removes `anon` access from every browser-backed
table, enables RLS, protects views, and permits only non-anonymous authenticated
users. This is a deliberately single-tenant pilot policy: invite only members of
one organization until workspace IDs and membership-scoped policies ship.

Create operator users through Supabase Auth administration; the dashboard does
not expose public signup. Keep `DASHBOARD_AUTH_REQUIRED=true` in hosted and pilot
environments. Setting it to `false` is a local development escape hatch and is
a locked rollout state: browser database credentials are removed and no live
workspace records load.

Apply and verify the policy non-interactively when a direct database connection
is available:

```bash
SECOPSAI_DASHBOARD_DATABASE_URL='postgresql://...' scripts/dashboard-security apply
SECOPSAI_DASHBOARD_DATABASE_URL='postgresql://...' scripts/dashboard-security verify
```

The script never prints the connection string. It fails unless every present
dashboard table has RLS enabled and has zero anonymous policies or grants.

The static console pins `@supabase/supabase-js` to an exact version with a
SHA-384 Subresource Integrity check. The Pages Worker adds CSP, anti-framing,
content-type, referrer, permissions, opener, and transport-security headers to
both static and API responses. Update the version and integrity hash together;
never restore an unversioned CDN import.

## Visual System

The dashboard uses an OKComputer_Sec-inspired dark command-plane skin: void-black shell, elevated dark panels, teal/cyan live-state accents, Lucide-style inline SVG navigation icons, compact mono metadata, and high-contrast status badges. The reference audit is tracked in [`docs/okcomputer-reference-audit.md`](docs/okcomputer-reference-audit.md). No Kimi runtime, compiled reference bundle, external image assets, or mock data are imported into production.

It now also reads native local SecOpsAI state through the helper server:
- triage summary
- pending/applyable triage actions
- latest orchestrator summaries
- latest local findings artifact metadata
- Hermes Agent findings and evidence when present in the local SOC store
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
- one deduplicated queue combining canonical Core findings with optional
  dashboard operational findings
- explicit record-owner labels so operators know where status is authoritative
- finding detail and correlation
- create a task directly from a finding

### SecOpsAI Edge
- canonical network assets and Edge-origin findings from SecOpsAI Core
- recent asset-graph changes created by the supervised Edge-to-Core sync service
- optional live sensor, site, schedule, and scan-job status from the Edge API
- a deliberate link to the separate sensor administration console when configured

Core remains the source of truth for graph and triage data. The helper may enrich
that view with live Edge operations by using server-side credentials. Hosted
Pages can now aggregate Core and Edge directly in its Worker, so a laptop tunnel
is not required for this read-only workspace. The browser
never receives `SECOPSAI_EDGE_OPERATIONS_TOKEN` or the deprecated
`SECOPSAI_EDGE_ADMIN_TOKEN` fallback. The workspace shows non-secret credential
expiry and warns when overlap-safe rotation is due.

### Research Cases
- Core-backed case queue and full investigation timeline
- structured subjects, evidence provenance, IOCs, and linked SOC findings
- deterministic publication readiness and responsible-disclosure state
- downloadable Markdown case reports
- readiness-gated, review-only Original Research drafts for Blog Ops

Research reads are available through the helper without a write token.
Mutations use `TRIAGE_OPS_ADMIN_TOKEN`; the browser never constructs or runs a
shell command.

The Research Cases workspace also includes a protected watchlist promotion
panel. Select one or more npm packages, click **Preview selected**, then click
**Create draft cases** after reviewing the result. Preview maps directly to
`research case from-watchlist` without creating records; creation uses the
admin token and remains idempotent. Package code is never fetched or executed
by this workflow.

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

The Triage Ops layout is organized around daily alert handling: summary metrics first, then a two-column workspace with **Supply Chain Alerts** and **Alert Review**. Filters live with the alert list, and Alert Review is split into Overview, Evidence, Analyst note, Evidence actions, Response actions, and CLI fallback. Protected response actions remain token-gated.

The **Run Evidence Verdict** action is read-only. It scores package-level maliciousness separately from local environment impact so advisory-backed ecosystem threats can remain actionable even when this repo does not currently use the package. The scorer checks advisory/denylist matches, known compromised versions, raw report indicators, scanner rules, local manifest usage, known IOCs, and missing evidence. It returns a recommended analyst note, score breakdown, mitigation actions, and copyable operator commands.

The **Campaign Research** panel is also read-only by default. Use it only when validated package, extension, or supply-chain evidence belongs to the same campaign. Paste/import campaign JSON or build the campaign in the form, click **Run Campaign Research**, then review the campaign verdict, package verdicts, local environment impact, correlations, IOCs, mitigation, and references. Correlation and local usage review are part of that one read-only action. **Persist Findings** and **Create Campaign Blog Draft** are separate protected actions that require the admin token and confirmation. Campaign blog drafts are created as review-only drafts and are never published automatically.

Campaign Research and **Autonomous Discovery** live in a collapsed advanced dock so the alert-review workflow stays readable. Click the dock to expand campaign intake. **Run Discovery** polls trusted SecOpsAI news/source registries and cached source metadata, extracts leads, and shows scored candidates. Each candidate includes an **Orchestrator Review** that classifies the report, separates source references from attacker IOCs, validates real packages/extensions, treats GitHub repos as project context unless package evidence exists, rejects extraction noise, and recommends the right route. **Use in Campaign Research** is available only for candidates routed to package Campaign Research without blockers. **Run Autopilot Dry Run** previews high-scoring orchestrator-approved package candidates without writing findings. Discovery itself does not expose finding persistence or blog-draft write buttons; use those protected actions only from reviewed Campaign Research output.

### Blog Ops
- GitHub Actions-backed security-blog news ingestion
- review queue for generated external-news drafts
- preview of draft body, source links, severity, and status
- edit modal for title, summary, severity, categories, references, and article markdown
- approval-gated approve/reject/needs-review controls
- publish-approved, rebuild-feeds, and deploy buttons

Blog Ops is intentionally protected. In hosted mode, the browser calls `/api/blog/*` Worker endpoints and the Worker dispatches the SecOpsAI `blog-ops.yml` workflow. In local helper mode, the same `/api/blog/*` contract is served by `dashboard_server.py` and mapped to allowlisted `secopsai blog ...` CLI argument arrays. Operators paste `BLOG_OPS_ADMIN_TOKEN` into the page for write actions; GitHub tokens stay server-side in Cloudflare Pages secrets and are not needed for local read-only draft/status review.

Local Blog Ops deploy is available when the helper can see `${SECOPSAI_ROOT}/blog` and either `wrangler` or `npx` is on `PATH`. The deploy button remains admin-token gated and runs only the fixed Wrangler Pages deploy for the SecOpsAI blog project; if that capability is unavailable, use hosted Blog Ops or the GitHub Actions / Cloudflare workflow.

### Guide

The **Guide** page is the in-dashboard operator manual. It covers the daily click path for Overview, Tasks, Findings, AI Dependency Guard, Native Triage, Triage Ops, Campaign Research, Autonomous Discovery, and Blog Ops. It also explains which actions are read-only, which actions are token-gated, when to use CLI fallback, why discovery candidates must pass Orchestrator Review before persistence or blog drafting, and why source domains are references rather than attacker IOCs.

The guide includes safe automation buttons for repetitive read-only work:
- **Run Daily Refresh** reloads dashboard data, helper state, Blog Ops status, Triage Ops alerts, and campaign fixtures.
- **Run Selected Alert Evidence Bundle** runs evidence verdict, investigate, explain verdict, advisory check, local usage check, and raw report for the selected SCM alert.
- **Run Discovery Review** runs read-only campaign discovery and opens the Triage Ops campaign dock for candidate review.
- Discovery candidates are automatically annotated with likely package rows vs obvious extraction noise so high scores are treated as "worth checking," not proof.
- Promoted campaign forms include **Clean Obvious Package Noise** for common false package extractions such as byline CSS classes, generic article words, ordinary websites, image filenames, numeric tokens, repository issue paths, and long encoded-looking slugs.
- Watchlist suggestions are generated from clean packages, publishers, actors, campaign IDs, repositories, malware names, and attacker IOCs. Source/reporting domains stay under source references instead of being suggested as attacker IOCs.
- **AI Dependency Guard** guidance shows how to scan AI-built code and optional OpenClaw/Hermes/session telemetry with `secopsai supply-chain ai-dependency-guard --path . --include-agent-logs --json`. Persisted guard findings render in the Findings queue with latest-first ordering, source evidence, registry context, recommended action, and CLI fallback. The dashboard never installs or executes packages for this flow.

These guide automations intentionally do not close findings, persist SOC findings, create blog drafts, approve drafts, publish posts, or bypass admin-token gates.

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

The launcher replaces an older `dashboard_server.py` process only when it is
listening from this dashboard directory on the requested local port. That keeps
Triage Ops Campaign Discovery from accidentally hitting a stale helper route
that only understands single-finding actions. If you intentionally want to keep
an existing helper, run with `SECOPSAI_DASHBOARD_REPLACE_STALE_HELPER=0`.

Optional `.env` values:
- `DASHBOARD_AUTH_REQUIRED`
  - defaults to `true`; keep enabled outside isolated local UI development
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
- `SECOPSAI_EDGE_API_URL`
  - optional Edge API base URL used by the local helper or hosted Pages Worker to load sensor operations
- `SECOPSAI_EDGE_OPERATIONS_TOKEN`
  - preferred server-only, workspace-scoped read credential for sites, sensors, schedules, scan jobs, and its own expiry; never place it in `config.js` or a `NEXT_PUBLIC_*` variable
- `SECOPSAI_CORE_API_URL`
  - hosted Core API origin used by the Pages Worker for the canonical graph and findings workspace
- `SECOPSAI_CORE_READ_TOKEN`
  - server-only Core operator read credential; configure it as a Pages secret and never expose it to browser configuration
- `SECOPSAI_EDGE_ADMIN_TOKEN`
  - deprecated server-only migration fallback; remove it after the scoped operations credential is verified
- `SECOPSAI_EDGE_DASHBOARD_URL`
  - optional public URL for the separate Edge sensor administration console

The browser sends its short-lived Supabase operator session to protected
same-origin Worker routes. The Worker validates that session with Supabase
before it uses any Core, Edge, helper, Blog Ops, or run-output credential. When
`DASHBOARD_AUTH_REQUIRED=false`, the Worker removes Supabase credentials from
browser configuration, the app renders a locked rollout screen, and protected
backend configuration is rejected. Live records are never loaded in this mode.

## Cloudflare Pages

For hosted deployment with same-origin backend endpoints, see [CLOUDFLARE_PAGES.md](./CLOUDFLARE_PAGES.md).
