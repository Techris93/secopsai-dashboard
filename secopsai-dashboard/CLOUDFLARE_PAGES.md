# Cloudflare Pages Deployment

This dashboard is now prepared for **Cloudflare Pages advanced mode** with a root-level [`_worker.js`](./_worker.js) that handles:

- `GET /config.js`
- `GET /api/integration-status`
- `POST /api/discord-notify`
- `POST /api/discord-send-message`
- `GET /api/run-output`

The worker falls back to `env.ASSETS.fetch(request)` for normal static files, which is the pattern Cloudflare documents for Pages advanced mode.

## What changed for hosted mode

- `config.js` is generated at the edge from Cloudflare environment variables instead of relying on the local Python helper.
- Run-output links are now same-origin and no longer hardcoded to `http://127.0.0.1:45680`.
- Hosted run-output delivery supports two modes:
  - **Recommended:** read output files from an R2 bucket binding.
  - **Fallback:** proxy to an upstream helper via `RUN_OUTPUT_BASE_URL`.
- The retired `/api/discord-send-message` route still returns `410 Gone` so the current UI behavior stays compatible.

## Recommended production architecture

For `dashboard.secopsai.dev` or any other permanent hosted domain, use:

1. Cloudflare Pages for the dashboard UI and edge endpoints.
2. Supabase for dashboard data.
3. Cloudflare R2 for run output files.
4. Optional Discord webhooks for `ops-log` and `kanban-updates`.

This keeps the browser talking only to same-origin dashboard endpoints while the worker reads config and private integrations server-side.

## Required Cloudflare values

Set these in **Workers & Pages → your project → Settings → Variables and Secrets**:

### Variables

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `APP_NAME`
- `DISCORD_SERVER_ID`
- `RUN_OUTPUT_R2_BINDING`
- `RUN_OUTPUT_R2_PREFIX`
- `RUN_OUTPUT_BASE_URL`
- `RUN_OUTPUT_AUTH_HEADER`

### Secrets

- `DISCORD_OPS_LOG_WEBHOOK`
- `DISCORD_KANBAN_UPDATES_WEBHOOK`
- `RUN_OUTPUT_AUTH_TOKEN`

Notes:

- `SUPABASE_URL` and `SUPABASE_ANON_KEY` are required for the app to load.
- `RUN_OUTPUT_R2_BINDING` defaults to `RUN_OUTPUTS`; only change it if you deliberately use a different binding name.
- You only need **one** run-output mode:
  - R2 mode: configure an R2 binding and optionally `RUN_OUTPUT_R2_PREFIX`.
  - Proxy mode: configure `RUN_OUTPUT_BASE_URL` and optionally auth settings.

## R2 key format

The dashboard asks `/api/run-output` for a path relative to the OpenClaw workspace root.

Example local file:

```text
/Users/chrixchange/.openclaw/workspace/secopsai-dashboard/runs/2026-04-20/output.txt
```

Expected relative path:

```text
secopsai-dashboard/runs/2026-04-20/output.txt
```

Recommended R2 object key:

```text
secopsai-dashboard/runs/2026-04-20/output.txt
```

If you want all run outputs under an R2 prefix, set:

```text
RUN_OUTPUT_R2_PREFIX=openclaw-workspace
```

Then the worker will look up:

```text
openclaw-workspace/secopsai-dashboard/runs/2026-04-20/output.txt
```

## Proxy mode contract

If you are not ready to move run outputs into R2 yet, point `RUN_OUTPUT_BASE_URL` at any helper endpoint that:

1. Accepts `GET ?path=<relative-path>`.
2. Returns either:
   - JSON shaped like `{ "ok": true, "text": "..." }`, or
   - plain text.

Optional auth:

- `RUN_OUTPUT_AUTH_HEADER=Authorization`
- `RUN_OUTPUT_AUTH_TOKEN=Bearer <token>`

## Local Pages-style preview

Create a local `.dev.vars` from [`.dev.vars.example`](./.dev.vars.example), then run:

```bash
npx wrangler pages dev .
```

That lets you test the worker, `config.js`, and `/api/*` routes locally before deploying.

## Step-by-step Cloudflare Pages setup

### 1. Push the dashboard repo

Push the repository that contains this dashboard to GitHub.

If you are deploying the standalone dashboard repo, use:

- repo: `Techris93/secopsai-dashboard`
- root directory: `/`

### 2. Create the Pages project

In Cloudflare:

1. Go to **Workers & Pages**.
2. Select **Create application**.
3. Select **Pages**.
4. Select **Connect to Git**.
5. Pick your dashboard repository.
6. Choose the production branch, usually `main`.

### 3. Configure build settings

Because this repo is static HTML/CSS/JS plus a root `_worker.js`, use:

- **Framework preset:** `None`
- **Build command:** `exit 0`
- **Build output directory:** `.`
- **Root directory:** leave blank unless this dashboard lives in a subfolder/monorepo

Why:

- Cloudflare recommends `exit 0` for projects without a framework build step when you still want Pages Functions support.
- `_worker.js` must live in the Pages output directory for advanced mode to take effect.

### 4. Add environment variables and secrets

Before or immediately after the first deploy, add the values listed in **Required Cloudflare values** above.

Minimum viable set:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `APP_NAME`
- `DISCORD_SERVER_ID`

If you want Discord test/notify buttons to work:

- `DISCORD_OPS_LOG_WEBHOOK`
- `DISCORD_KANBAN_UPDATES_WEBHOOK`

### 5. Configure hosted run-output mode

Choose one:

#### Option A: R2-backed run outputs

Recommended if this dashboard is going to be your permanent hosted control plane.

1. In Cloudflare, create an R2 bucket for run outputs.
2. In **Workers & Pages → your project → Settings → Bindings**, add an **R2 bucket** binding.
3. Use binding name `RUN_OUTPUTS`.
4. Optionally set `RUN_OUTPUT_R2_PREFIX`.
5. Make sure your run-output uploader writes keys that match the dashboard’s relative output paths.

#### Option B: Upstream proxy

Good bridge option if you already have a helper service that can read the files.

1. Deploy or keep a small helper endpoint somewhere private.
2. Set `RUN_OUTPUT_BASE_URL` to that helper endpoint.
3. If the helper requires auth, also set:
   - `RUN_OUTPUT_AUTH_HEADER`
   - `RUN_OUTPUT_AUTH_TOKEN`

### 6. Deploy

Select **Save and Deploy** in Cloudflare Pages.

After deployment, verify:

1. `/config.js` returns real config values.
2. The dashboard loads and connects to Supabase.
3. **Integrations** shows `cloudflare-pages` mode for Discord.
4. A run output link opens `view-run-output.html` on the same domain.

### 7. Attach your custom domain

To put this behind a production host such as `dashboard.secopsai.dev`:

1. Open your Pages project.
2. Go to **Custom domains**.
3. Select **Set up a domain**.
4. Enter your desired host.
5. Complete Cloudflare’s DNS activation flow.

If the domain is already managed in the same Cloudflare zone, Cloudflare can usually create the DNS record automatically.

### 8. Add preview deployments

Keep preview deployments enabled so every branch or PR gets a Pages preview URL.

That is especially useful for this dashboard because you can validate:

- Supabase connectivity
- run-output route behavior
- worker config changes
- visual changes

### 9. Move any remaining localhost assumptions out of your pipeline

If you still use the legacy/local dispatcher for any notifications, set:

```text
DASHBOARD_BASE_URL=https://dashboard.secopsai.dev
```

in the dispatcher environment so links sent to Discord point to the hosted dashboard instead of localhost.

## Recommended first production checks

After the first live deployment:

1. Open the dashboard.
2. Click **Mission Control**.
3. Click **Refresh data**.
4. Open **Integrations** and confirm webhook status.
5. Open a completed run and click **View output**.
6. Send a non-critical Discord test to `ops-log`.

## Official Cloudflare docs used

- Advanced mode: https://developers.cloudflare.com/pages/functions/advanced-mode/
- Bindings: https://developers.cloudflare.com/pages/functions/bindings/
- Git integration: https://developers.cloudflare.com/pages/configuration/git-integration/
- Build configuration: https://developers.cloudflare.com/pages/configuration/build-configuration/
- Custom domains: https://developers.cloudflare.com/pages/configuration/custom-domains/
