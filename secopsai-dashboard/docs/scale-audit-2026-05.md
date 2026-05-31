# SecOpsAI Dashboard Scale Audit - May 31, 2026

The dashboard has two data-access modes:

- Hosted Cloudflare Worker mode in `_worker.js`, which serves static assets,
  talks to GitHub APIs for Blog Ops, and optionally proxies helper-backed
  SecOpsAI actions.
- Local helper mode in `dashboard_server.py`, which runs allowlisted SecOpsAI CLI
  commands and reads local evidence/report files.

## Risks Reviewed

- N+1 reads: local Triage Ops reread dependency manifests for each alert, and
  hosted Blog Ops fetched draft JSON bodies one by one.
- Missing pagination: Blog Ops had a hard cap, but no explicit limit plumbing.
- Missing indexes: no dashboard database is used; indexing work belongs in the
  SecOpsAI SOC store.
- Connection pooling: hosted mode uses Cloudflare `fetch`; local mode shells out
  to short-lived allowlisted CLI commands rather than holding DB connections.
- Overbroad fetches: list views should keep summaries separate from detail
  payloads.

## Fixes

- `dashboard_server.py` now caches dependency manifest text by path, mtime, and
  size so Triage Ops alert summaries do not reread every manifest for every
  package.
- `_worker.js` now has explicit draft-list limit handling and bounded batched
  draft metadata loading.
- Tests cover manifest cache reuse and draft-list limit behavior.

## Operating Guidance

- Keep hosted helper-backed actions disabled unless a deliberate
  `SECOPSAI_HELPER_BASE_URL` is configured.
- Keep Blog Ops list views capped. Use detail endpoints for full draft bodies.
- If draft volume grows past the current cap, add a generated
  `blog/drafts/index.json` summary file instead of relying on one GitHub content
  fetch per draft.
- If Triage Ops alert volume grows, prefer direct summary fields from the
  SecOpsAI CLI/API and reserve raw reports for detail actions.
