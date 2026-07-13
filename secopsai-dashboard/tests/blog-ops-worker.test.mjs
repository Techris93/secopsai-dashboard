import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../_worker.js";

async function jsonFrom(response) {
  return JSON.parse(await response.text());
}

async function testStatusWithoutGithubTokenIsSafe() {
  const response = await worker.fetch(new Request("https://dashboard.example/api/blog/status"), {});
  assert.equal(response.status, 200);
  const payload = await jsonFrom(response);
  assert.equal(payload.ok, true);
  assert.equal(payload.configured, false);
  assert.equal(payload.config.github_configured, false);
  assert.equal("token" in payload.config, false);
}

async function testConfigExposesTriageOpsEndpoint() {
  const response = await worker.fetch(new Request("https://dashboard.example/config.js"), {});
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /triageOpsEndpoint/);
  assert.equal(body.includes("/api/secopsai/triage-ops"), true);
  assert.equal(body.includes("/api/secopsai/edge-workspace"), true);
}

async function testIntegrationStatusExposesCampaignApi() {
  const response = await worker.fetch(new Request("https://dashboard.example/api/integration-status"), {
    SECOPSAI_HELPER_BASE_URL: "https://helper.example",
    BLOG_OPS_GITHUB_TOKEN: "ghp_test_value",
  });
  assert.equal(response.status, 200);
  const payload = await jsonFrom(response);
  assert.equal(payload.helper.secopsai_campaign_api, true);
  assert.equal(payload.helper.secopsai_edge_api, true);
  assert.equal(payload.blog_ops.mode, "hosted-github-actions");
  assert.equal(payload.blog_ops.capabilities.deploy, true);
}

async function testDiscordNotifyRequiresDedicatedToken() {
  const body = JSON.stringify({ channel: "ops-log", content: "hello ops" });
  const unconfigured = await worker.fetch(
    new Request("https://dashboard.example/api/discord-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
    { DISCORD_OPS_LOG_WEBHOOK: "https://discord.example/webhook" },
  );
  assert.equal(unconfigured.status, 501);
  const unconfiguredPayload = await jsonFrom(unconfigured);
  assert.equal(unconfiguredPayload.code, "not_configured");
  assert.equal(JSON.stringify(unconfiguredPayload).includes("https://discord.example/webhook"), false);

  const unauthorized = await worker.fetch(
    new Request("https://dashboard.example/api/discord-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
    {
      DISCORD_NOTIFY_TOKEN: "notify-secret",
      DISCORD_OPS_LOG_WEBHOOK: "https://discord.example/webhook",
    },
  );
  assert.equal(unauthorized.status, 401);
  const unauthorizedPayload = await jsonFrom(unauthorized);
  assert.match(unauthorizedPayload.error, /Unauthorized/);
  assert.equal(JSON.stringify(unauthorizedPayload).includes("notify-secret"), false);
}

async function testDiscordNotifyAuthorizedForwardsWebhook() {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response("ok", { status: 200 });
  };
  try {
    const response = await worker.fetch(
      new Request("https://dashboard.example/api/discord-notify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-discord-notify-token": "notify-secret",
        },
        body: JSON.stringify({ channel: "ops-log", content: "hello ops" }),
      }),
      {
        DISCORD_NOTIFY_TOKEN: "notify-secret",
        DISCORD_OPS_LOG_WEBHOOK: "https://discord.example/webhook",
      },
    );
    assert.equal(response.status, 200);
    const payload = await jsonFrom(response);
    assert.equal(payload.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://discord.example/webhook");
    assert.deepEqual(JSON.parse(calls[0].init.body), { content: "hello ops" });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testTriageOpsHostedModeFailsClearlyWithoutHelper() {
  const response = await worker.fetch(new Request("https://dashboard.example/api/secopsai/triage-ops/alerts"), {});
  assert.equal(response.status, 501);
  const payload = await jsonFrom(response);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /SECOPSAI_HELPER_BASE_URL/);
  assert.equal(JSON.stringify(payload).includes("secret"), false);
}

async function testTriageOpsWriteNeedsAdminToken() {
  const response = await worker.fetch(
    new Request("https://dashboard.example/api/secopsai/triage-ops/close", {
      method: "POST",
      body: JSON.stringify({ finding_id: "SCM-ABC123" }),
    }),
    {
      SECOPSAI_HELPER_BASE_URL: "https://helper.example",
      TRIAGE_OPS_ADMIN_TOKEN: "triage-admin",
    },
  );
  assert.equal(response.status, 401);
  const payload = await jsonFrom(response);
  assert.match(payload.error, /Unauthorized/);
  assert.equal(JSON.stringify(payload).includes("triage-admin"), false);
}

async function testTriageOpsAuthorizedWriteProxiesToHelper() {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, proxied: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const response = await worker.fetch(
      new Request("https://dashboard.example/api/secopsai/triage-ops/close", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Triage-Ops-Admin-Token": "triage-admin",
        },
        body: JSON.stringify({ finding_id: "SCM-ABC123", note: "reviewed with source-backed evidence" }),
      }),
      {
        SECOPSAI_HELPER_BASE_URL: "https://helper.example",
        TRIAGE_OPS_ADMIN_TOKEN: "triage-admin",
      },
    );
    assert.equal(response.status, 200);
    const payload = await jsonFrom(response);
    assert.equal(payload.ok, true);
    assert.equal(JSON.stringify(payload).includes("triage-admin"), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://helper.example/api/secopsai/triage-ops/close");
    assert.equal(calls[0].init.headers.get("X-Triage-Ops-Admin-Token"), "triage-admin");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testTriageOpsEvidenceVerdictIsReadOnlyProxy() {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, package_verdict: "likely_true_positive" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const response = await worker.fetch(
      new Request("https://dashboard.example/api/secopsai/triage-ops/evidence-verdict", {
        method: "POST",
        body: JSON.stringify({ finding_id: "SCM-ABC123", package: "mistralai", version: "2.4.6" }),
      }),
      {
        SECOPSAI_HELPER_BASE_URL: "https://helper.example",
        TRIAGE_OPS_ADMIN_TOKEN: "triage-admin",
      },
    );
    assert.equal(response.status, 200);
    const payload = await jsonFrom(response);
    assert.equal(payload.package_verdict, "likely_true_positive");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://helper.example/api/secopsai/triage-ops/evidence-verdict");
    assert.equal(calls[0].init.headers.has("X-Triage-Ops-Admin-Token"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testTriageOpsHelperUpstream502IsActionableJson() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("Unable to reach the origin service: dial tcp 127.0.0.1:45680: connect: connection refused token=super-secret", {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  try {
    const response = await worker.fetch(
      new Request("https://dashboard.example/api/secopsai/triage-ops/refresh-evidence", {
        method: "POST",
        body: "{}",
      }),
      {
        SECOPSAI_HELPER_BASE_URL: "https://helper.example",
      },
    );
    assert.equal(response.status, 502);
    assert.match(response.headers.get("Content-Type") || "", /application\/json/);
    const payload = await jsonFrom(response);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "helper_upstream_error");
    assert.equal(payload.upstream_status, 502);
    assert.match(payload.error, /SecOpsAI helper upstream HTTP 502/);
    assert.match(payload.hint, /SECOPSAI_HELPER_BASE_URL/);
    assert.equal(JSON.stringify(payload).includes("super-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testTriageOpsCloudflare1033HasTunnelHint() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("error code: 1033 token=super-secret", {
      status: 530,
      headers: { "Content-Type": "text/plain" },
    });
  try {
    const response = await worker.fetch(
      new Request("https://dashboard.example/api/secopsai/triage-ops/refresh-evidence", {
        method: "POST",
        body: "{}",
      }),
      {
        SECOPSAI_HELPER_BASE_URL: "https://stale-tunnel.example",
      },
    );
    assert.equal(response.status, 530);
    const payload = await jsonFrom(response);
    assert.equal(payload.code, "helper_tunnel_unreachable");
    assert.match(payload.hint, /live helper\/tunnel URL/);
    assert.equal(JSON.stringify(payload).includes("super-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testCampaignResearchIsReadOnlyProxy() {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, result: { campaign_verdict: "confirmed_true_positive" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const response = await worker.fetch(
      new Request("https://dashboard.example/api/secopsai/triage-ops/research-campaign", {
        method: "POST",
        body: JSON.stringify({ campaign: { packages: [{ ecosystem: "npm", package: "chalk-tempalte", version: "0.0.1" }] } }),
      }),
      {
        SECOPSAI_HELPER_BASE_URL: "https://helper.example",
        TRIAGE_OPS_ADMIN_TOKEN: "triage-admin",
      },
    );
    assert.equal(response.status, 200);
    const payload = await jsonFrom(response);
    assert.equal(payload.result.campaign_verdict, "confirmed_true_positive");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://helper.example/api/secopsai/triage-ops/research-campaign");
    assert.equal(calls[0].init.headers.has("X-Triage-Ops-Admin-Token"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testCampaignDiscoveryIsReadOnlyProxy() {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, candidates: [{ candidate_id: "unit-campaign" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const response = await worker.fetch(
      new Request("https://dashboard.example/api/secopsai/triage-ops/campaign-discover", {
        method: "POST",
        body: JSON.stringify({ since: "24h", limit: 10 }),
      }),
      {
        SECOPSAI_HELPER_BASE_URL: "https://helper.example",
        TRIAGE_OPS_ADMIN_TOKEN: "triage-admin",
      },
    );
    assert.equal(response.status, 200);
    const payload = await jsonFrom(response);
    assert.equal(payload.candidates[0].candidate_id, "unit-campaign");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://helper.example/api/secopsai/triage-ops/campaign-discover");
    assert.equal(calls[0].init.headers.has("X-Triage-Ops-Admin-Token"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testCampaignAutopilotIsReadOnlyProxy() {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, result: { selected_candidates: 1 }, candidates: [{ candidate_id: "unit-campaign" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const response = await worker.fetch(
      new Request("https://dashboard.example/api/secopsai/triage-ops/campaign-autopilot", {
        method: "POST",
        body: JSON.stringify({ since: "24h", limit: 10, min_score: 35, persist: false }),
      }),
      {
        SECOPSAI_HELPER_BASE_URL: "https://helper.example",
        TRIAGE_OPS_ADMIN_TOKEN: "triage-admin",
      },
    );
    assert.equal(response.status, 200);
    const payload = await jsonFrom(response);
    assert.equal(payload.result.selected_candidates, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://helper.example/api/secopsai/triage-ops/campaign-autopilot");
    assert.equal(calls[0].init.headers.has("X-Triage-Ops-Admin-Token"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testCampaignWriteNeedsAdminToken() {
  const response = await worker.fetch(
    new Request("https://dashboard.example/api/secopsai/triage-ops/campaign-persist-findings", {
      method: "POST",
      body: JSON.stringify({ campaign: { packages: [{ ecosystem: "npm", package: "chalk-tempalte", version: "0.0.1" }] } }),
    }),
    {
      SECOPSAI_HELPER_BASE_URL: "https://helper.example",
      TRIAGE_OPS_ADMIN_TOKEN: "triage-admin",
    },
  );
  assert.equal(response.status, 401);
  const payload = await jsonFrom(response);
  assert.match(payload.error, /Unauthorized/);
  assert.equal(JSON.stringify(payload).includes("triage-admin"), false);
}

async function testCampaignWatchlistNeedsAdminToken() {
  const response = await worker.fetch(
    new Request("https://dashboard.example/api/secopsai/triage-ops/campaign-watchlist", {
      method: "POST",
      body: JSON.stringify({ package: "npm:chalk-tempalte" }),
    }),
    {
      SECOPSAI_HELPER_BASE_URL: "https://helper.example",
      TRIAGE_OPS_ADMIN_TOKEN: "triage-admin",
    },
  );
  assert.equal(response.status, 401);
  const payload = await jsonFrom(response);
  assert.match(payload.error, /Unauthorized/);
  assert.equal(JSON.stringify(payload).includes("triage-admin"), false);
}

function testCampaignResearchUiIsPresent() {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const startScript = readFileSync(new URL("../start-local-dashboard-stack.sh", import.meta.url), "utf8");
  const serveScript = readFileSync(new URL("../serve-dashboard.sh", import.meta.url), "utf8");
  assert.match(html, /triage-ops-campaign-research/);
  assert.match(html, /Campaign Research & Autonomous Discovery/);
  assert.match(html, /triage-filter-drawer/);
  assert.match(app, /Campaign API/);
  assert.match(app, /Run Campaign Research/);
  assert.match(app, /Import Campaign JSON/);
  assert.match(app, /Persist Findings/);
  assert.match(app, /Create Campaign Blog Draft/);
  assert.match(app, /Autonomous Discovery/);
  assert.match(app, /Run Discovery/);
  assert.match(app, /Run Autopilot Dry Run/);
  assert.match(app, /Orchestrator Review/);
  assert.match(app, /Candidate type/);
  assert.match(app, /Supply-chain relevance/);
  assert.match(app, /No package artifacts validated/);
  assert.match(app, /Use in Campaign Research/);
  assert.match(app, /Run Campaign Research includes correlation and local usage review/);
  assert.match(app, /older helper route/);
  assert.match(app, /Restart or update the local SecOpsAI dashboard helper/);
  assert.match(app, /Evidence actions/);
  assert.match(app, /Response actions/);
  assert.match(app, /campaign-persist-findings/);
  assert.match(app, /campaign-blog-draft/);
  assert.match(app, /campaign-discover/);
  assert.match(app, /campaign-autopilot/);
  assert.match(app, /orchestrate-candidate/);
  assert.match(startScript, /Replacing stale local dashboard helper/);
  assert.match(serveScript, /Replacing stale local dashboard helper/);
}

function testOkComputerSkinIsPresent() {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const audit = readFileSync(new URL("../docs/okcomputer-reference-audit.md", import.meta.url), "utf8");
  assert.match(html, /class="okcomputer-skin"/);
  assert.match(html, /<span class="nav-icon" aria-hidden="true"><svg/);
  assert.match(css, /OKComputer_Sec reference skin/);
  assert.match(css, /--void-black: #050507/);
  assert.match(css, /--teal-primary: #00d4c8/);
  assert.match(audit, /Live reference/);
  assert.match(audit, /Kimi seed script was not copied/);
  assert.equal(html.includes("kimi.com/sdk-seed.js"), false);
}

function testOperatorGuideUiIsPresent() {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(html, /data-page="operator-guide"/);
  assert.match(html, /id="page-operator-guide"/);
  assert.match(html, /Operator Guide/);
  assert.match(html, /Automated guide steps/);
  assert.match(html, /Run Daily Refresh/);
  assert.match(html, /Run Selected Alert Evidence Bundle/);
  assert.match(html, /Run Discovery Review/);
  assert.match(html, /Assisted Candidate Cleanup/);
  assert.match(html, /Clean Obvious Package Noise/);
  assert.match(html, /AI Dependency Guard workflow/);
  assert.match(html, /secopsai supply-chain ai-dependency-guard --path \. --json/);
  assert.match(html, /OpenClaw, Hermes, and session telemetry/);
  assert.match(html, /generated watchlist suggestions/);
  assert.match(html, /package-noise summary/);
  assert.match(html, /verify it is real/);
  assert.match(html, /Overview daily workflow/);
  assert.match(html, /Tasks daily workflow/);
  assert.match(html, /Findings daily workflow/);
  assert.match(html, /Native Triage daily workflow/);
  assert.match(html, /Triage Ops daily workflow/);
  assert.match(html, /Blog Ops daily workflow/);
  assert.match(html, /Autonomous Discovery is a lead generator/);
  assert.match(html, /Discovery write actions are intentionally not shown/);
  assert.match(app, /"operator-guide"/);
  assert.match(app, /Dashboard operator guide/);
  assert.match(app, /runDailyGuideRefresh/);
  assert.match(app, /runTriageOpsEvidenceBundle/);
  assert.match(app, /runGuideDiscoveryReview/);
  assert.match(app, /evidence-bundle/);
  assert.match(app, /analyzeCampaignPackageNoise/);
  assert.match(app, /cleanCampaignPackageNoise/);
  assert.match(app, /function isAiDependencyGuardFinding/);
  assert.match(app, /AI Dependency Guard risks/);
  assert.match(app, /AI Dependency Guard evidence/);
  assert.match(app, /aiDependencyGuardCliFallback/);
  assert.match(app, /campaignWatchlistSuggestions/);
  assert.match(app, /campaign-watchlist-suggestion/);
  assert.match(app, /Review Selected Lead/);
  assert.match(app, /campaign-orchestrate/);
  assert.match(app, /Show raw helper output/);
  assert.match(app, /Refresh evidence completed/);
  assert.match(app, /Publish approved writes approved drafts into blog\/posts and rebuilds feeds while keeping them Approved/);
  assert.match(app, /moves staged approved drafts to Deployed/);
  assert.match(app, /cve-\\d\{4\}-\\d\{4,\}/);
  assert.match(app, /docs-internal-guid/);
  assert.match(app, /sanitizeCampaignSummary/);
  assert.match(app, /Sources, IOCs, actors, and behavior indicators/);
  assert.match(app, /Import or inspect Campaign JSON/);
  assert.match(css, /Operator guide/);
  assert.match(css, /\.guide-layout/);
  assert.match(css, /\.guide-step/);
  assert.match(css, /\.guide-toc/);
  assert.match(css, /\.guide-header-actions/);
  assert.match(css, /\.campaign-package-noise/);
  assert.match(css, /\.campaign-watchlist-suggestions/);
  assert.match(css, /\.campaign-orchestrator-review/);
  assert.match(css, /\.triage-output-compact/);
  assert.match(css, /\.triage-raw-drawer/);
  assert.match(css, /\.campaign-review-drawer/);
  assert.match(css, /\.campaign-action-hint/);
}

async function testWriteNeedsAdminToken() {
  const response = await worker.fetch(
    new Request("https://dashboard.example/api/blog/news-run", { method: "POST", body: "{}" }),
    { BLOG_OPS_GITHUB_TOKEN: "ghp_test_value" },
  );
  assert.equal(response.status, 501);
  const payload = await jsonFrom(response);
  assert.equal(payload.code, "not_configured");
  assert.match(payload.error, /admin token/i);
}

async function testDispatchPayloadIsWorkflowOnly() {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };
  try {
    const response = await worker.fetch(
      new Request("https://dashboard.example/api/blog/news-run", {
        method: "POST",
        headers: { "X-Blog-Ops-Admin-Token": "admin-test" },
        body: JSON.stringify({ limit: 3 }),
      }),
      {
        BLOG_OPS_GITHUB_TOKEN: "ghp_secret_should_not_return",
        BLOG_OPS_ADMIN_TOKEN: "admin-test",
        BLOG_OPS_OWNER: "Techris93",
        BLOG_OPS_REPO: "secopsai",
        BLOG_OPS_WORKFLOW: "blog-ops.yml",
      },
    );
    assert.equal(response.status, 202);
    const payload = await jsonFrom(response);
    assert.equal(payload.ok, true);
    assert.equal(payload.dispatched, true);
    assert.equal(payload.action, "news-run");
    assert.equal(JSON.stringify(payload).includes("ghp_secret"), false);
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.inputs, { action: "news-run", limit: "3" });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testHostedBlogOpsGlobalActionsMapToWorkflowInputs() {
  const expectedActions = ["news-fetch", "news-draft", "news-run", "publish-approved", "rebuild-feeds", "deploy"];
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };
  try {
    for (const action of expectedActions) {
      const response = await worker.fetch(
        new Request(`https://dashboard.example/api/blog/${action}`, {
          method: "POST",
          headers: { "X-Blog-Ops-Admin-Token": "admin-test" },
          body: JSON.stringify({ limit: 4 }),
        }),
        {
          BLOG_OPS_GITHUB_TOKEN: "ghp_secret_should_not_return",
          BLOG_OPS_ADMIN_TOKEN: "admin-test",
          BLOG_OPS_OWNER: "Techris93",
          BLOG_OPS_REPO: "secopsai",
          BLOG_OPS_WORKFLOW: "blog-ops.yml",
        },
      );
      assert.equal(response.status, 202);
      const payload = await jsonFrom(response);
      assert.equal(payload.action, action);
      assert.equal(JSON.stringify(payload).includes("ghp_secret"), false);
    }
    assert.equal(calls.length, expectedActions.length);
    const dispatched = calls.map((call) => JSON.parse(call.init.body).inputs);
    assert.deepEqual(dispatched, expectedActions.map((action) => ({ action, limit: "4" })));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testGithubWorkflowNotFoundIsActionable() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  try {
    const response = await worker.fetch(
      new Request("https://dashboard.example/api/blog/news-run", {
        method: "POST",
        headers: { "X-Blog-Ops-Admin-Token": "admin-test" },
        body: JSON.stringify({ limit: 3 }),
      }),
      {
        BLOG_OPS_GITHUB_TOKEN: "ghp_secret_should_not_return",
        BLOG_OPS_ADMIN_TOKEN: "admin-test",
        BLOG_OPS_OWNER: "Techris93",
        BLOG_OPS_REPO: "secopsai",
        BLOG_OPS_WORKFLOW: "blog-ops.yml",
        BLOG_OPS_REF: "main",
      },
    );
    assert.equal(response.status, 502);
    const payload = await jsonFrom(response);
    assert.match(payload.error, /BLOG_OPS_WORKFLOW=blog-ops\.yml/);
    assert.match(payload.error, /Actions read\/write/);
    assert.equal(JSON.stringify(payload).includes("ghp_secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testSaveDraftDispatchIncludesEditedFields() {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };
  try {
    const response = await worker.fetch(
      new Request("https://dashboard.example/api/blog/drafts/news-abc/save", {
        method: "POST",
        headers: { "X-Blog-Ops-Admin-Token": "admin-test" },
        body: JSON.stringify({
          title: "Edited title",
          summary: "Edited summary",
          severity: "high",
          categories: "Security News, Threat Intelligence",
          references: "https://example.com/source",
          body_markdown: "# Edited title\n\nEnough source-backed body text for a useful editor test.",
          note: "edited in test",
        }),
      }),
      {
        BLOG_OPS_GITHUB_TOKEN: "ghp_secret_should_not_return",
        BLOG_OPS_ADMIN_TOKEN: "admin-test",
        BLOG_OPS_OWNER: "Techris93",
        BLOG_OPS_REPO: "secopsai",
        BLOG_OPS_WORKFLOW: "blog-ops.yml",
      },
    );
    assert.equal(response.status, 202);
    const payload = await jsonFrom(response);
    assert.equal(payload.action, "save-draft");
    assert.equal(JSON.stringify(payload).includes("ghp_secret"), false);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.inputs.action, "save-draft");
    assert.equal(body.inputs.draft, "news-abc");
    assert.equal(body.inputs.title, "Edited title");
    assert.equal(body.inputs.severity, "high");
    assert.match(body.inputs.body_markdown, /Enough source-backed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testDraftListHonorsLimitAndAvoidsUnboundedFetches() {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/contents/blog/drafts?")) {
      return new Response(
        JSON.stringify([
          { type: "file", name: "one.json", path: "blog/drafts/one.json" },
          { type: "file", name: "two.json", path: "blog/drafts/two.json" },
          { type: "file", name: "three.json", path: "blog/drafts/three.json" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        content: btoa(JSON.stringify({ title: "Draft", slug: "draft", updated_at: "2026-05-31T00:00:00Z" })),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const response = await worker.fetch(
      new Request("https://dashboard.example/api/blog/drafts?limit=2"),
      {
        BLOG_OPS_GITHUB_TOKEN: "ghp_secret_should_not_return",
        BLOG_OPS_OWNER: "Techris93",
        BLOG_OPS_REPO: "secopsai",
      },
    );
    assert.equal(response.status, 200);
    const payload = await jsonFrom(response);
    assert.equal(payload.drafts.length, 2);
    assert.equal(calls.filter((url) => url.includes("/contents/blog/drafts/")).length, 2);
    assert.equal(JSON.stringify(payload).includes("ghp_secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function testBlogOpsActionControlsAreNotDuplicated() {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const actions = [...html.matchAll(/data-blog-action="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(actions.sort(), [
    "deploy",
    "news-draft",
    "news-fetch",
    "news-run",
    "publish-approved",
    "rebuild-feeds",
  ].sort());
  assert.equal((html.match(/data-blog-action="publish-approved"/g) || []).length, 1);
  assert.equal(html.includes("blog-refresh-drafts-btn"), false);
  assert.equal(html.includes("id=\"blog-publish-approved-btn\""), false);
  assert.equal(app.includes("blog-publish-approved-btn"), false);
  assert.match(app, /blog-publish-ready-callout/);
  assert.match(app, /No approved drafts are ready to publish/);
  assert.match(html, /Publish approved to blog/);
  assert.match(html, /Deploy blog to Cloudflare/);
  assert.match(app, /Publish approved writes approved drafts into blog\/posts and rebuilds feeds while keeping them Approved/);
  assert.match(app, /moves staged approved drafts to Deployed/);
  assert.match(html, /drafts remain under <strong>Approved<\/strong>/);
  assert.match(html, /move to <strong>Deployed<\/strong>/);
  assert.match(app, /approved_publishable/);
  assert.match(app, /approved_blocked/);
  assert.match(app, /Approved draft\(s\) are blocked by readiness checks/);
  assert.match(app, /Images & source screenshots/);
  assert.match(app, /attach-source-media/);
  assert.match(app, /Source image attachment is available in local helper mode only/);
  assert.match(app, /attachedMediaKeys/);
  assert.match(app, /candidateKeys/);
  assert.match(app, /media_url: candidate\.src \|\| candidate\.url \|\| ''/);
  assert.match(app, />Attached<\/span>/);
}

function testTriageOpsActionabilityControlsArePresent() {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(html, /triage-ops-filter-actionability/);
  assert.match(html, /Actionable only/);
  assert.match(app, /actionability\.bucket/);
  assert.match(app, /No actionable SCM alerts match this filter/);
  assert.match(app, /Blog drafts are disabled for no-local-impact or review-only scanner records/);
}

function testCampaignDiscoveryActionsAreNotDuplicated() {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /Load Saved Candidates/);
  assert.match(app, /Review Selected Lead/);
  assert.match(app, /Use in Campaign Research/);
  assert.match(app, /Discovery does not persist findings or create blog drafts/);
  assert.equal(app.includes("campaign-autopilot-persist-btn"), false);
  assert.equal(app.includes("campaign-autopilot-draft-btn"), false);
  assert.equal(app.includes("campaign-correlate-btn"), false);
  assert.equal(app.includes("campaign-local-usage-btn"), false);
  assert.match(app, /Package artifacts/);
  assert.match(app, /Projects \/ repos/);
  assert.match(app, /Raw helper output \(debug\)/);
}

function testDashboardListsUseLatestFirstOrdering() {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /function sortLatestFirst\(/);
  assert.match(app, /function latestFirstDateValue\(/);
  assert.match(app, /function sortedFindings\(/);
  assert.match(app, /const findings = sortedFindings\(\)/);
  assert.match(app, /state\.blogOps\.drafts = sortLatestFirst\(payload\.drafts \|\| \[\], BLOG_DRAFT_LATEST_FIELDS\)/);
  assert.match(app, /state\.blogOps\.runs = sortLatestFirst\(payload\.runs \|\| \[\], BLOG_RUN_LATEST_FIELDS\)/);
  assert.match(app, /sortLatestFirst\(\(state\.triageOps\.alerts \|\| \[\]\)\.filter/);
  assert.match(app, /state\.triageOps\.alerts = sortLatestFirst\(payload\.alerts \|\| \[\], FINDING_LATEST_FIELDS\)/);
  assert.match(app, /function campaignCandidates\(\)/);
  assert.match(app, /state\.triageOps\.campaignCandidates = sortLatestFirst\(result\.candidates, CAMPAIGN_CANDIDATE_LATEST_FIELDS\)/);
}

function testEdgeWorkspaceUiIsPresentAndReadOnly() {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(html, /data-page="edge"/);
  assert.match(html, /id="page-edge"/);
  assert.match(html, /id="edge-sensors"/);
  assert.match(html, /id="edge-assets"/);
  assert.match(html, /id="edge-findings"/);
  assert.match(app, /async function loadEdgeWorkspace/);
  assert.match(app, /function renderEdgeWorkspace/);
  assert.equal(html.includes("SECOPSAI_EDGE_ADMIN_TOKEN"), false);
  assert.equal(app.includes("SECOPSAI_EDGE_ADMIN_TOKEN"), false);
  assert.equal(html.includes("cdn.tailwindcss.com"), false);
}

await testStatusWithoutGithubTokenIsSafe();
await testConfigExposesTriageOpsEndpoint();
await testIntegrationStatusExposesCampaignApi();
await testDiscordNotifyRequiresDedicatedToken();
await testDiscordNotifyAuthorizedForwardsWebhook();
await testTriageOpsHostedModeFailsClearlyWithoutHelper();
await testTriageOpsWriteNeedsAdminToken();
await testTriageOpsAuthorizedWriteProxiesToHelper();
await testTriageOpsEvidenceVerdictIsReadOnlyProxy();
await testTriageOpsHelperUpstream502IsActionableJson();
await testTriageOpsCloudflare1033HasTunnelHint();
await testCampaignResearchIsReadOnlyProxy();
await testCampaignDiscoveryIsReadOnlyProxy();
await testCampaignAutopilotIsReadOnlyProxy();
await testCampaignWriteNeedsAdminToken();
await testCampaignWatchlistNeedsAdminToken();
testCampaignResearchUiIsPresent();
testOkComputerSkinIsPresent();
testOperatorGuideUiIsPresent();
await testWriteNeedsAdminToken();
await testDispatchPayloadIsWorkflowOnly();
await testHostedBlogOpsGlobalActionsMapToWorkflowInputs();
await testGithubWorkflowNotFoundIsActionable();
await testSaveDraftDispatchIncludesEditedFields();
await testDraftListHonorsLimitAndAvoidsUnboundedFetches();
testBlogOpsActionControlsAreNotDuplicated();
testTriageOpsActionabilityControlsArePresent();
testCampaignDiscoveryActionsAreNotDuplicated();
testDashboardListsUseLatestFirstOrdering();
testEdgeWorkspaceUiIsPresentAndReadOnly();
console.log("blog ops worker tests passed");
