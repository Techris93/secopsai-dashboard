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
}

async function testIntegrationStatusExposesCampaignApi() {
  const response = await worker.fetch(new Request("https://dashboard.example/api/integration-status"), {
    SECOPSAI_HELPER_BASE_URL: "https://helper.example",
  });
  assert.equal(response.status, 200);
  const payload = await jsonFrom(response);
  assert.equal(payload.helper.secopsai_campaign_api, true);
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
  assert.match(app, /Promote to Campaign Research/);
  assert.match(app, /older helper route/);
  assert.match(app, /Restart or update the local SecOpsAI dashboard helper/);
  assert.match(app, /Evidence actions/);
  assert.match(app, /Response actions/);
  assert.match(app, /campaign-persist-findings/);
  assert.match(app, /campaign-blog-draft/);
  assert.match(app, /campaign-discover/);
  assert.match(app, /campaign-autopilot/);
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
  assert.match(html, /Clean Obvious Package Noise/);
  assert.match(html, /generated watchlist suggestions/);
  assert.match(html, /Overview daily workflow/);
  assert.match(html, /Tasks daily workflow/);
  assert.match(html, /Findings daily workflow/);
  assert.match(html, /Native Triage daily workflow/);
  assert.match(html, /Triage Ops daily workflow/);
  assert.match(html, /Blog Ops daily workflow/);
  assert.match(html, /Autonomous Discovery is a lead generator/);
  assert.match(html, /Do not click Persist Findings/);
  assert.match(app, /"operator-guide"/);
  assert.match(app, /Dashboard operator guide/);
  assert.match(app, /runDailyGuideRefresh/);
  assert.match(app, /runTriageOpsEvidenceBundle/);
  assert.match(app, /runGuideDiscoveryReview/);
  assert.match(app, /evidence-bundle/);
  assert.match(app, /analyzeCampaignPackageNoise/);
  assert.match(app, /cleanCampaignPackageNoise/);
  assert.match(app, /campaignWatchlistSuggestions/);
  assert.match(app, /campaign-watchlist-suggestion/);
  assert.match(css, /Operator guide/);
  assert.match(css, /\.guide-layout/);
  assert.match(css, /\.guide-step/);
  assert.match(css, /\.guide-toc/);
  assert.match(css, /\.guide-header-actions/);
  assert.match(css, /\.campaign-package-noise/);
  assert.match(css, /\.campaign-watchlist-suggestions/);
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

await testStatusWithoutGithubTokenIsSafe();
await testConfigExposesTriageOpsEndpoint();
await testIntegrationStatusExposesCampaignApi();
await testTriageOpsHostedModeFailsClearlyWithoutHelper();
await testTriageOpsWriteNeedsAdminToken();
await testTriageOpsAuthorizedWriteProxiesToHelper();
await testTriageOpsEvidenceVerdictIsReadOnlyProxy();
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
await testGithubWorkflowNotFoundIsActionable();
await testSaveDraftDispatchIncludesEditedFields();
console.log("blog ops worker tests passed");
