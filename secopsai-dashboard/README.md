# Mission Control Application

This directory contains the deployable SecOpsAI Mission Control application,
local Python helper, tests, and Cloudflare Pages configuration. See the
[repository README](../README.md) for the product overview and operator tour.

Mission Control turns the SecOpsAI CLI and data stores into an operator-facing
workspace. It shows what needs attention, explains why an action is available
or blocked, and keeps local helper commands, model review, disclosure,
publication, and deployment behind explicit safety boundaries.

## Application Scope

| Workspace | Purpose |
| --- | --- |
| Today | See the single highest-priority decision, ordered follow-ups, active safe automation, and service health |
| Findings | Triage evidence-backed detections with impact, confidence, ownership, and safe next actions |
| Assets | Review the SecOpsAI Edge inventory, changes, sensors, schedules, scans, and Wi-Fi context |
| Work | Manage tasks, approvals, investigations, execution runs, and recovery |
| Research | Classify leads, operate watchlists, build durable cases, review evidence, and control sandbox/disclosure gates |
| Publications | Fetch sources, review drafts and media, approve content, stage posts, preserve the archive, and deploy separately |
| Automation | Select models, configure explicit fallbacks, operate the Artifact Fleet, run universal Source-First Artifact Research, and review jobs |
| System | Inspect connector health, credentials, audit context, and hosted/local capability boundaries |

The deployable UI uses one primary navigation model. Supply Chain Triage,
Native Triage, Campaign Research, Blog Ops, and SecOpsAI Edge remain available
under the operator job they support.

## Decision-First Operation

Mission Control starts with **Today**, not a wall of totals. It orders work by
operational consequence: model blockage, missing safe-automation configuration,
degraded collection, approvals, blocked ownership, validation blockers, open
findings, then active backlog. Queue size is context, not a verdict.

Every operational workspace presents a **Recommended next step** and separates
what SecOpsAI can safely automate from what the operator must decide. The
canonical automation path is the scheduled daily workflow plus guarded alert
review, guarded evidence investigation, and read-only specialist routing.
SecOpsAI does not silently change a selected model, enable fallback, raise
concurrency, publish, disclose, submit artifacts, contain systems, or perform a
destructive action.

The complete design and automation boundaries are recorded in
[Mission Control Redesign Checkpoints](docs/mission-control-redesign-checkpoints.md).

## Local Start

The local stack is the complete operator mode for helper-backed SecOpsAI
actions:

```bash
cp .env.example .env
```

Set the local Core path and replace placeholder credentials in `.env`:

```dotenv
SECOPSAI_ROOT=/absolute/path/to/secopsai
INTELLIGENCE_ADMIN_TOKEN=generate-a-long-random-value
TRIAGE_OPS_ADMIN_TOKEN=generate-a-long-random-value
BLOG_OPS_ADMIN_TOKEN=generate-a-long-random-value
```

Start the stack:

```bash
./start-local-dashboard-stack.sh
```

Open [http://127.0.0.1:45680](http://127.0.0.1:45680). Keep the terminal open
while using the console.

The browser never runs arbitrary shell commands. Local buttons call typed
helper routes that map to fixed SecOpsAI argument arrays. Exact local artifact
paths remain CLI-only.

## Local And Hosted Modes

| Capability | Local helper | Hosted Cloudflare Pages |
| --- | --- | --- |
| Supabase-backed dashboard data | Available when configured | Available when configured |
| Core and Edge read APIs | Available | Available through server-side Worker credentials |
| Native triage and local evidence | Available | Requires an intentionally configured private helper |
| Campaign, Artifact Fleet, and exact package actions | Available | Safe `not_configured` response without a helper/Core action endpoint |
| Blog draft review | Available | Available through protected GitHub workflow dispatch |
| Blog deployment | Available only when the reported capability is ready | Available through the configured GitHub/Cloudflare workflow |
| Secrets | Local `.env`; never committed | Cloudflare variables and secrets; never browser configuration |

`SECOPSAI_HELPER_BASE_URL` is optional and should stay unset in hosted
production unless a live private helper is deliberately operated. The retired
`secopsai-helper.secopsai.dev` tunnel is not a default. With no helper, the
hosted UI explains which actions require local mode instead of returning a
misleading tunnel failure.

## Safety Model

- Operator sign-in and action authorization are separate controls.
- Hosted protected routes validate the Supabase operator session before using server-side Core, Edge, helper, Blog Ops, or run-output credentials.
- Action tokens are retained only for the current browser session and are never written into URLs.
- Artifact analysis does not install packages, run lifecycle scripts, activate extensions, execute binaries, or accept browser-selected filesystem paths.
- Model fallback is explicit; primary-only mode never silently selects a different provider.
- Sandbox submission, external disclosure, unverified rule activation, publication, and deployment remain separately approval-gated.
- Publishing approved content stages the reviewed archive; deployment is a distinct action and changes state only after deployment succeeds.

Read [Cloudflare Pages Deployment](CLOUDFLARE_PAGES.md) for the complete Worker,
R2, Supabase, Blog Ops, helper, and credential configuration.

## Intelligence And Research Contracts

**Automation → Models** persists any model returned by the configured OpenCodex
catalog. Operators can use primary-only mode or deliberately enable an ordered
fallback policy for quota/authentication failures or broader provider
availability failures.

**Automation → Research pipeline** is the canonical Artifact Fleet workspace:

1. Index registry metadata.
2. Run deterministic static and YARA checks.
3. Queue minimized evidence for the selected model when enabled.
4. Escalate suspicious or inconclusive artifacts.
5. Review the analyst queue and evidence-linked Research Case.
6. Create a review-only draft after publication readiness passes.

**Source-First Artifact Research** fetches exact metadata for the selected
ecosystem, verifies checksums where available, quarantines approved artifacts,
performs no-execution analysis, optionally compares a verified reference, and
creates a durable case. Crates.io/Rust is one adapter; npm, PyPI, Packagist,
Go, Maven, NuGet, RubyGems, Open VSX, GitHub, Hugging Face, containers, and
approved archives use the same pipeline.

The full operational design is documented in:

- [Artifact Fleet Operations](https://docs.secopsai.dev/artifact-fleet-operations/)
- [Research and Verification](https://docs.secopsai.dev/research-and-verification/)
- [Universal Source-First Research](https://docs.secopsai.dev/universal-source-first-research/)
- [Intelligence Integrations](https://docs.secopsai.dev/intelligence-integrations/)

## Publication Contract

Publications separates editorial and delivery state:

1. Fetch trusted news or create a source-backed research draft.
2. Review claims, references, extracted intelligence, and proposed media.
3. Approve, reject, or return the draft to review.
4. Publish approved drafts into the complete staged blog archive.
5. Deploy the staged archive with the separate protected deployment action.

Media attachment resets a draft to review so the image and alt text can be
checked. Rebuilds preserve older published posts rather than replacing the
archive with only the newest batch.

See [Security Blog Publishing](https://docs.secopsai.dev/blog-publishing/) for
the lifecycle and recovery procedures.

## Configuration

The local template is [`.env.example`](.env.example). Important settings:

| Setting | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Authenticated dashboard data access |
| `DASHBOARD_AUTH_REQUIRED` | Must remain `true` for hosted and pilot environments |
| `SECOPSAI_ROOT` | Absolute path to the local SecOpsAI Core checkout |
| `INTELLIGENCE_ADMIN_TOKEN` | Model, investigation, learning, and service controls |
| `TRIAGE_OPS_ADMIN_TOKEN` | Protected triage and research write actions |
| `BLOG_OPS_ADMIN_TOKEN` | Protected editorial and deployment actions |
| `SECOPSAI_EDGE_API_URL` | Read-only Edge integration endpoint |
| `SECOPSAI_EDGE_OPERATIONS_TOKEN` | Server-side Edge read credential |

Generate independent, high-entropy action tokens and keep `.env` out of
version control. Hosted values belong in Cloudflare Pages variables and
secrets, not `config.js` or a public JavaScript bundle.

## Development

```bash
npm run check
npm test
python3 -m py_compile dashboard_server.py
python3 -m unittest tests/test_triage_ops_evidence.py -q
git diff --check
```

`npm test` includes the console information-architecture contract. The
README product-tour fixture at
`tests/fixtures/readme-product-tour.html` is representative documentation
data only and is not loaded by production routes.

## Deployment

Mission Control is compatible with Cloudflare Pages advanced mode through
`_worker.js`. The Worker generates runtime configuration, applies security
headers, protects backend routes, and falls back to static assets for the UI.

```bash
npx --yes wrangler@latest pages deploy . \
  --project-name secopsai-dashboard \
  --branch main
```

Do not deploy until the Supabase migration, invited operator account, RLS
verification, Cloudflare secrets, and capability-specific integration checks
in [CLOUDFLARE_PAGES.md](CLOUDFLARE_PAGES.md) are complete.

## License

[MIT](../LICENSE)
