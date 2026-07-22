# SecOpsAI Dashboard Module Audit - 2026-05-31

This audit maps the dashboard files by responsibility and records cleanup
decisions. The dashboard intentionally has two backend surfaces: hosted
Cloudflare Worker routes and local helper routes. They overlap by route family,
but they are not interchangeable.

## Dashboard Inventory

| Area | Files | Responsibility | Cleanup decision |
| --- | --- | --- | --- |
| Browser UI | `index.html`, `app.js`, `styles.css`, `favicon.svg`, `radar-texture.png` | Single-page dashboard, navigation, Triage Ops, Blog Ops, operator guide, and visual design. | Kept. `app.js` is large but is the only browser app implementation. |
| Hosted Worker | `_worker.js` | Cloudflare Pages API routes for config, Blog Ops via GitHub Actions, run-output proxying, Discord notify, and optional helper proxying. | Kept. Hosted mode must not run local shell commands. |
| Local helper | `dashboard_server.py`, `serve-dashboard.sh`, `start-local-dashboard-stack.sh` | Local-only helper-backed SecOpsAI CLI actions, Triage Ops, Campaign Research, Blog Ops draft/review, and optional allowlisted blog deploy. | Kept. It is the local-control-plane counterpart to the hosted Worker. |
| Config generation | `config.template.js`, `generate-config.py`, `.dev.vars.example`, `.env.example` | Browser config and examples for hosted/local environments. | Kept. Generated `config.js` is ignored and untracked so an obsolete checkout cannot ship stale runtime endpoints or branding. |
| Data/schema | `secopsai-dashboard-seed.sql`, `supabase_migrations/*` | Supabase seed and migration SQL. | Kept. Not duplicated by runtime code. |
| Tests | `tests/blog-ops-worker.test.mjs`, `tests/test_triage_ops_evidence.py` | Worker and local helper regression tests. | Kept. Tests cover the intentional hosted/local split. |
| Docs | `README.md`, `CLOUDFLARE_PAGES.md`, `CONTROL_PANEL_MODE.md`, `docs/*` | Operator setup, deployment, redesign/audit notes. | Kept. Audit docs are historical/operator references. |
| Utility pages | `log-agent-run.html`, `view-run-output.html` | Standalone viewer/helper pages. | Kept. They are distinct browser views, not duplicate dashboard pages. |

## Cleanup Applied

- Removed `../_worker.js` from `npm run check`. The canonical dashboard repo
  should validate its own `_worker.js` only. Checking a sibling worker couples
  this repo to another working copy and recreates the old “two dashboards”
  mismatch.
- Added local ignores for `.env`, `__pycache__/`, `.pytest_cache/`, and `*.pyc`
  so helper/test artifacts do not appear as dashboard modules.

## Intentional Overlaps Not Removed

- `_worker.js` and `dashboard_server.py` both expose `/api/*`-style behavior,
  but one is hosted/proxy-only and one is local/helper-backed. Merging them
  would either weaken hosted safety or remove local CLI functionality.
- `loadBlogDraft` exists in both `app.js` and `_worker.js`; one is a browser
  fetch helper and the other loads GitHub content in the Worker.
- Blog Ops deploy logic exists in UI, Worker, and local helper, but each layer
  enforces a different boundary: button state, hosted workflow dispatch, and
  local allowlisted Wrangler command.

## Follow-Up Candidates

- Split `app.js` by feature (`mission-control`, `triage-ops`, `blog-ops`,
  `operator-guide`) once a bundling strategy exists. Today it remains a single
  no-build file for Cloudflare Pages simplicity.
- Consider sharing small constants between `_worker.js` and `dashboard_server.py`
  through generated documentation/tests, not runtime imports, because they run in
  different languages and trust boundaries.
