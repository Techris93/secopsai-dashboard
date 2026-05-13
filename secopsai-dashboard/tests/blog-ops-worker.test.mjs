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

await testStatusWithoutGithubTokenIsSafe();
await testWriteNeedsAdminToken();
await testDispatchPayloadIsWorkflowOnly();
console.log("blog ops worker tests passed");
