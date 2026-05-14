import assert from "node:assert/strict";
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
await testTriageOpsHostedModeFailsClearlyWithoutHelper();
await testTriageOpsWriteNeedsAdminToken();
await testTriageOpsAuthorizedWriteProxiesToHelper();
await testTriageOpsEvidenceVerdictIsReadOnlyProxy();
await testWriteNeedsAdminToken();
await testDispatchPayloadIsWorkflowOnly();
await testSaveDraftDispatchIncludesEditedFields();
console.log("blog ops worker tests passed");
