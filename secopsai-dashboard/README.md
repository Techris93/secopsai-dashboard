# SecOpsAI Dashboard

The Research page includes a Core-backed discovery panel for cross-ecosystem watchlists, scoped monitors, due-run execution, candidates, safe exact-package comparison, and campaign correlation. Research writes require the protected research action token; provider credentials remain server-side.

This directory contains the live dashboard app for SecOpsAI.

## Mission Control product tour

**SecOpsAI Mission Control is the evidence-first operator console for detection,
investigation, source-first package research, guarded model automation, and
reviewed security publishing.** The screenshots use representative sample data;
they contain no live credentials, private telemetry, or customer records.

[![SecOpsAI Mission Control overview](https://raw.githubusercontent.com/Techris93/secopsai/main/docs/assets/mission-control/overview.png)](https://github.com/Techris93/secopsai/blob/main/docs/assets/mission-control/overview.png)

<table>
  <tr>
    <td width="50%">
      <a href="https://github.com/Techris93/secopsai/blob/main/docs/assets/mission-control/model-routing.png"><img src="https://raw.githubusercontent.com/Techris93/secopsai/main/docs/assets/mission-control/model-routing.png" alt="SecOpsAI model routing workspace with primary and fallback model controls" /></a>
      <br /><strong>Models.</strong> Choose and persist any catalog model, then control whether ordered fallbacks are disabled, quota/auth-only, or provider-availability aware.
    </td>
    <td width="50%">
      <a href="https://github.com/Techris93/secopsai/blob/main/docs/assets/mission-control/research-pipeline.png"><img src="https://raw.githubusercontent.com/Techris93/secopsai/main/docs/assets/mission-control/research-pipeline.png" alt="SecOpsAI safe package research pipeline and evidence readiness" /></a>
      <br /><strong>Research pipeline.</strong> Turn registry metadata and no-execution artifact evidence into an auditable Research Case and review-only draft.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="https://github.com/Techris93/secopsai/blob/main/docs/assets/mission-control/findings.png"><img src="https://raw.githubusercontent.com/Techris93/secopsai/main/docs/assets/mission-control/findings.png" alt="SecOpsAI evidence-backed findings backlog" /></a>
      <br /><strong>Findings.</strong> Work the latest detections first with evidence state, environment impact, ownership, and the next safe action visible.
    </td>
    <td width="50%">
      <a href="https://github.com/Techris93/secopsai/blob/main/docs/assets/mission-control/publications.png"><img src="https://raw.githubusercontent.com/Techris93/secopsai/main/docs/assets/mission-control/publications.png" alt="SecOpsAI editorial review and publication lifecycle" /></a>
      <br /><strong>Publications.</strong> Review claims and attached media, approve content, publish approved files to staging, and deploy separately.
    </td>
  </tr>
</table>

[![SecOpsAI Enterprise Security workspace](https://raw.githubusercontent.com/Techris93/secopsai/main/docs/assets/mission-control/enterprise.png)](https://github.com/Techris93/secopsai/blob/main/docs/assets/mission-control/enterprise.png)

Every high-impact boundary stays explicit: package code is not executed,
fallback models are opt-in, active DAST requires authorization, publication
requires editorial review, and deployment is a separate protected action.

The dashboard is now intentionally narrow:
- overview of operational state
- findings queue and correlation
- task management
- native triage queue visibility
- helper-backed native SecOpsAI actions
- Hermes Agent telemetry findings when SecOpsAI is refreshed with `--platform hermes`
- protected Supply Chain Triage (technical route: Triage Ops) for supply-chain alert review and response
- a unified SecOpsAI Edge workspace backed by the canonical Core graph and findings store
- explicit Edge-to-Core sync freshness so operators can distinguish current,
  stale, and never-synced graph context
- durable Research Cases for evidence, IOCs, disclosure, exports, and review-only publication handoff
- Blog Ops workflow dispatch and review queue
- Enterprise Security workspace for truthful connector readiness, normalized event intake, vulnerability priority, Kubernetes dry-run posture, DAST scope validation, and governance records
- built-in operator guide for dashboard click paths and safety rules
- Supabase-backed integration status
- SecOpsAI Intelligence controls for the local Codex bridge and hosted read-only ChatGPT app

It is not a Discord control plane and not a generic multi-agent org shell.

## SecOpsAI Intelligence

The **Administration → Automation** page contains one operator surface for two separate integrations:

- **Local Codex bridge** queues fixed, read-only analysis actions and processes them with the Codex CLI login already owned by the operator. The dashboard never stores a ChatGPT credential.
- **ChatGPT app** exposes nine read-only SecOpsAI tools through the hosted OAuth MCP endpoint. ChatGPT authenticates the model session; SecOpsAI OAuth independently authorizes access to SecOpsAI data.

Use **Administration → Automation → Models** to choose any model returned by
OpenCodex, persist it as the primary, and optionally configure an ordered
fallback chain. Fallback is explicit: primary-only, quota/authentication-only,
or provider-availability failures. With primary-only selected, an unavailable
model leaves the job queued instead of silently consuming another provider.

Use **Administration → Automation → Research pipeline** for the canonical
Artifact Fleet and exact crates.io workflow. It replaces the former duplicate
Enterprise controls and presents one evidence path from registry metadata and
static/YARA findings through selected-model triage, analyst review, and a
review-only draft.

For a local dashboard, configure an action credential in `.env`:

```bash
openssl rand -hex 32
# Put the generated value in INTELLIGENCE_ADMIN_TOKEN. Do not commit it.
```

Restart `./start-local-dashboard-stack.sh`, open **Administration → Automation**, and enter the **Automation action token** beside the local bridge controls before running learning cycles, model review, investigation controls, or service actions. The credential is sent only to the configured helper and retained in session storage for the current browser tab.

Existing pilot installations may continue to use `TRIAGE_OPS_ADMIN_TOKEN` when a separate `INTELLIGENCE_ADMIN_TOKEN` is not configured. Enter the credential once in **Administration → Automation → Automation action token**; it is retained only in the current browser tab. A missing or rejected action credential must produce an in-page error and must never sign the operator out. Operator sign-in and local action authorization are separate controls.

### Daily workflow automation

**Administration → Automation → Investigations** coordinates due
registry surveillance, candidate draft promotion, alert feedback and model
review queueing, evidence investigations, guarded detection learning, and
operational alert delivery. Configure the interval and bounded limits, click
**Save daily workflow**, then use **Run full workflow now** for the first cycle.
The existing research worker checks the same persisted schedule on each cycle,
so a separate scheduler is not required. Each cycle records every step and can
finish as `degraded` when one step fails; disclosure, sandbox submission,
publication, and unverified detector activation remain separate approvals.

Hosted Cloudflare Pages uses server-side variables instead:

- `SECOPSAI_CORE_API_URL`
- `SECOPSAI_CORE_READ_TOKEN`
- `SECOPSAI_CORE_INTELLIGENCE_TOKEN`
- `SECOPSAI_MCP_URL`

These values belong in Pages secrets/variables, never `config.js` or a `NEXT_PUBLIC_*` value. The Core intelligence and bridge tokens must be different from each other and from the Core read token. Operator email/password access remains Supabase invitation-only and is separate from every integration credential.

Leave `SECOPSAI_MCP_URL` unset until the OAuth-protected MCP service has a successful deployment. The local Codex bridge and hosted Core queue do not depend on it.

The complete OAuth, Render, local-service, and ChatGPT developer-app procedure is in [Intelligence integrations](https://docs.secopsai.dev/intelligence-integrations/).

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

### Credential URL protection

Operator credentials must never be entered into a URL. Mission Control accepts
authentication through the protected sign-in form only. The local helper and
Cloudflare Worker reject credential-like query parameters, redact them from
local request logs, and redirect document requests to a clean path. The browser
also removes any legacy credential-looking parameters from the current history
entry before the application loads. If a real password was ever visible in an
address bar, change it immediately and remove the affected browser-history
entry; the dashboard does not recover or store that value.

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

## Console information architecture

The operator experience is organized around the work a security operator needs
to complete, rather than around the names of internal services:

- **Overview** — priorities, changes, health, and next actions
- **Findings** — the canonical security issue queue, including Supply Chain views
- **Assets** — network inventory, changes, sensors, scans, schedules, and Wi-Fi
- **Work** — tasks, approvals, investigations, and execution runs
- **Research** — leads, durable cases, evidence, disclosure, and sandbox jobs
- **Publications** — news intake, drafts, editorial review, and delivery
- **System** — health, integrations, credentials, and audit context

Supply Chain Triage, Native Triage, Edge, Blog Ops, and Guide remain available
through nested views and help, but are no longer presented as competing
top-level products. Select a primary section in the sidebar to reveal its
route-level views and direct panel anchors beneath it; the top bar is reserved
for workspace context and no longer contains a second navigation row. The
active primary section is a disclosure control: select it again to collapse its
secondary views, and select it once more to expand them. The chevron and
`aria-expanded` state always report whether the nested navigation is open. The
browser URL is now a durable route such as
`#findings`, `#assets`, `#research/cases`, or `#publications`, so a review can be
shared and restored with browser back/forward navigation.

The redesigned shell is implemented in the existing Cloudflare Pages-compatible
frontend as a staged migration. Existing helper, Supabase, Edge, Core, research,
and Blog Ops contracts remain unchanged while individual screens move to shared
navigation, command search, contextual help, explicit degraded states, and
common feedback components. See [`docs/dashboard-ia.md`](docs/dashboard-ia.md)
for the migration boundaries and acceptance rules.

For approval-gated dynamic analysis, Mission Control supports both the configured
Tria.ge connector and a manual public-sandbox handoff. The manual path re-verifies
the approved artifact hash, downloads one no-store copy for operator upload, and
accepts only a sanitized report reference and reviewed behavior summary afterward.
It never executes the sample or uploads it automatically.

## Pages

### Enterprise Security

Enterprise Security is organized around three operator jobs rather than a list
of implemented modules:

- **Monitor** distinguishes an implemented parser from a configured source and
  from a source that has produced recent evidence. Operators can import bounded
  approved AWS, GCP, or Kubernetes JSON through the protected local helper.
- **Assess** prioritizes vulnerabilities, checks Kubernetes manifests without
  mutating a cluster, validates an authorized DAST plan without launching it,
  and exposes the safe Artifact Fleet research workflow.
- **Govern** stores owned compliance controls and draft questionnaires, threat
  models, and penetration-test engagements with latest-first operator records.

Enterprise status uses its own SQLite/PostgreSQL adapter and returns real
counts, source cursors, latest events, vulnerabilities, controls, workflows,
and dead-letter state. A ready database is never presented as proof that a
connector is active. Protected actions use the Automation action token and the
typed `/api/secopsai/enterprise-action` helper route; the browser cannot supply
filesystem paths or shell commands.

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
- one-click, revisioned investigation pipeline using the local Codex subscription bridge
- structured subjects, evidence provenance, IOCs, and linked SOC findings
- deterministic publication readiness and responsible-disclosure state
- downloadable Markdown case reports
- readiness-gated, review-only Original Research drafts for Blog Ops

Research reads are available through the helper without a write token.
Mutations use `TRIAGE_OPS_ADMIN_TOKEN`; the browser never constructs or runs a
shell command.

The Research workspace includes cross-ecosystem watchlists and a protected
promotion path. After a reviewed candidate becomes a draft case, select the
case and click **Run Investigation Pipeline**. Core performs bounded static
intake, optionally compares a verified legitimate package, and queues
minimized analysis through the installed Local Codex/OpenCodex Bridge. Mission
Control updates automatically and can complete bounded evidence review, record
an evidence-linked agent verdict, and rerun publication safety. No artifact
upload or copied prompt is required, and package code is never executed.
External sandbox submission, disclosure delivery, customer-control changes,
and final publication remain explicit human approvals.

For the complete operator path from a lead to a reviewed publication, see
[`docs/research-operator-runbook.md`](docs/research-operator-runbook.md). The
short version is: use **Supply Chain Triage** for an incoming `SCM-*` alert,
use **Research** for the durable investigation, and use **Blog Ops** for the
final editorial approval and deployment. These are connected stages, not
duplicate queues.

### Native Triage
- helper readiness
- pending action queue
- recent orchestrator summaries
- findings/orchestrator freshness
- direct native investigate, apply-action, and guarded close controls

### Supply Chain Triage (Triage Ops)
- supply-chain `SCM-*` alert queue from native SecOpsAI
- one-click investigate, evidence-based verdict, explain verdict, advisory check, local dependency usage check, raw report preview, and mitigation generation
- cross-ecosystem Campaign Research panel for campaign JSON import, package/IOC/source entry, correlation, local usage checks, SOC finding persistence, and review-only campaign blog drafts
- confirmation-gated close as false positive, move to in review, and create blog draft actions
- evidence-gated autonomous finding triage with selectable OpenCodex models, durable decisions, shadow tuning, and rollback
- copyable CLI fallback for every selected alert

Triage Ops uses the local/helper-backed `/api/secopsai/triage-ops/*` endpoints. The browser never runs shell commands directly. Read actions can run through the helper; write actions require `TRIAGE_OPS_ADMIN_TOKEN` or `BLOG_OPS_ADMIN_TOKEN`.

The Triage Ops layout is organized around daily alert handling: summary metrics first, then a two-column workspace with **Supply Chain Alerts** and **Alert Review**. Filters live with the alert list, and Alert Review is split into Overview, Evidence, Analyst note, Evidence actions, Response actions, and CLI fallback. Protected response actions remain token-gated.

The **Run Evidence Verdict** action is read-only. It scores package-level maliciousness separately from local environment impact so advisory-backed ecosystem threats can remain actionable even when this repo does not currently use the package. The scorer checks advisory/denylist matches, known compromised versions, raw report indicators, scanner rules, local manifest usage, known IOCs, and missing evidence. It returns a recommended analyst note, score breakdown, mitigation actions, and copyable operator commands.

The Supply Chain queue shows all active package intelligence by default. A
missing dependency reference is displayed as **Local exposure: not observed in
this repository** and never as proof that the package is benign. Source-backed,
known-bad, suspicious, and unresolved packages remain visible as **Ecosystem
intelligence** at their original scanner severity while the operator runs Safe
Package Intake, comparison, Research Case validation, and organization-wide
exposure checks.

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

The **Guide** page is the in-dashboard operator manual. It covers the daily click path for Overview, Tasks, Findings, Research Cases, AI Dependency Guard, Native Triage, Supply Chain Triage, Campaign Research, Autonomous Discovery, and Blog Ops. It also explains which actions are read-only, which actions are token-gated, how credentials are created and recovered, when to use CLI fallback, why discovery candidates must pass Orchestrator Review before persistence or blog drafting, and why source domains are references rather than attacker IOCs.

The guide includes safe automation buttons for repetitive read-only work:
- **Run Daily Refresh** reloads dashboard data, helper state, Blog Ops status, Supply Chain Triage alerts, and campaign fixtures.
- **Run Selected Alert Evidence Bundle** runs evidence verdict, investigate, explain verdict, advisory check, local usage check, and raw report for the selected SCM alert.
- **Run Discovery Review** runs read-only campaign discovery and opens the Supply Chain Triage campaign dock for candidate review.
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
- `config.js` — ignored runtime output generated from local environment values or served dynamically by the Cloudflare Worker; never commit it
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
listening from this dashboard directory, or from another checkout with the same
Git origin, on the requested local port. It prints both paths before replacing a
different checkout. That keeps Mission Control from silently serving an older
UI or helper contract. Unrelated local servers are never stopped. If you
intentionally want to keep an existing dashboard helper, run with
`SECOPSAI_DASHBOARD_REPLACE_STALE_HELPER=0`; set
`SECOPSAI_DASHBOARD_REPLACE_OTHER_CHECKOUT=0` to keep a related checkout.

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
- `TRIAGE_API_TOKEN`
  - optional server-side Tria.ge Researcher API token. It enables approval-gated **Submit to Tria.ge** and **Refresh Tria.ge result** actions while remaining invisible to browser configuration.
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
# Mission Control local artifact workflow

Research case detail includes a local-only **Import Authorized Artifact** action. It requires the protected research action token and a running local Core helper. Package bytes are quarantined and analyzed locally; the hosted dashboard never receives raw artifacts.
