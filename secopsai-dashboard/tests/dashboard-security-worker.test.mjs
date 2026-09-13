import assert from "node:assert/strict";
import workerModule from "../_worker.js";

const OPERATOR_TOKEN = "operator-session";
const authProfile = { id: "operator-1", email: "operator@example.com", role: "authenticated" };

function authFetcher(profile = authProfile) {
  return {
    async fetch() {
      return new Response(JSON.stringify(profile), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
}

function hostedEnv(overrides = {}) {
  return {
    DASHBOARD_AUTH_REQUIRED: "true",
    SUPABASE_URL: "https://test-project.supabase.co",
    SUPABASE_ANON_KEY: "test-anon-key",
    SUPABASE_AUTH_FETCHER: authFetcher(),
    SECOPSAI_HELPER_ALLOWED_ORIGINS: "https://helper.example",
    RUN_OUTPUT_ALLOWED_ORIGINS: "https://output.example",
    ...overrides,
  };
}

function operatorRequest(url, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${OPERATOR_TOKEN}`);
  return new Request(url, { ...init, headers });
}

async function jsonFrom(response) {
  return JSON.parse(await response.text());
}

async function testStaticAssetsAreAllowlisted() {
  const calls = [];
  const env = {
    DASHBOARD_AUTH_REQUIRED: "false",
    ASSETS: {
      async fetch(request) {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  };

  for (const path of ["/index.html", "/url-safety.js"]) {
    const allowed = await workerModule.fetch(new Request(`https://dashboard.example${path}`), env);
    assert.equal(allowed.status, 200, path);
  }
  assert.deepEqual(calls, ["/index.html", "/url-safety.js"]);

  for (const path of ["/.env", "/dashboard_debug.log", "/logs/anything", "/tests/fixture.json", "/%2eenv"]) {
    const response = await workerModule.fetch(new Request(`https://dashboard.example${path}`), env);
    assert.equal(response.status, 404, path);
  }
  assert.deepEqual(calls, ["/index.html", "/url-safety.js"]);
}

async function testAnonymousOperatorProfilesAreRejected() {
  const response = await workerModule.fetch(
    operatorRequest("https://dashboard.example/api/integration-status"),
    hostedEnv({ SUPABASE_AUTH_FETCHER: authFetcher({ id: "anonymous-1", is_anonymous: true }) }),
  );
  assert.equal(response.status, 401);
  const payload = await jsonFrom(response);
  assert.equal(payload.code, "operator_session_invalid");
}

async function testContentPackWritesRequireAndForwardActionToken() {
  const unauthorised = await workerModule.fetch(
    operatorRequest("https://dashboard.example/api/secopsai/content-packs/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ case_id: "RSC-ABCDEF123456" }),
    }),
    hostedEnv({ SECOPSAI_HELPER_BASE_URL: "https://helper.example", TRIAGE_OPS_ADMIN_TOKEN: "research-admin" }),
  );
  assert.equal(unauthorised.status, 401);

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, pack: { pack_id: "CPK-1" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const response = await workerModule.fetch(
      operatorRequest("https://dashboard.example/api/secopsai/content-packs/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Triage-Ops-Admin-Token": "research-admin",
        },
        body: JSON.stringify({ case_id: "RSC-ABCDEF123456" }),
      }),
      hostedEnv({ SECOPSAI_HELPER_BASE_URL: "https://helper.example", TRIAGE_OPS_ADMIN_TOKEN: "research-admin" }),
    );
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://helper.example/api/secopsai/content-packs/generate");
    assert.equal(calls[0].init.headers.get("X-Triage-Ops-Admin-Token"), "research-admin");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testHostedHelperProxyRequiresAnHttpsOriginAndRejectsRedirects() {
  const invalid = await workerModule.fetch(
    operatorRequest("https://dashboard.example/api/secopsai/triage-state"),
    hostedEnv({ SECOPSAI_HELPER_BASE_URL: "http://helper.example" }),
  );
  assert.equal(invalid.status, 503);
  assert.equal((await jsonFrom(invalid)).code, "helper_proxy_config_invalid");

  const missingAllowlist = await workerModule.fetch(
    operatorRequest("https://dashboard.example/api/secopsai/triage-state"),
    hostedEnv({ SECOPSAI_HELPER_BASE_URL: "https://unlisted.example", SECOPSAI_HELPER_ALLOWED_ORIGINS: "" }),
  );
  assert.equal(missingAllowlist.status, 503);
  assert.equal((await jsonFrom(missingAllowlist)).code, "helper_proxy_config_invalid");

  const disallowed = await workerModule.fetch(
    operatorRequest("https://dashboard.example/api/secopsai/triage-state"),
    hostedEnv({ SECOPSAI_HELPER_BASE_URL: "https://unlisted.example" }),
  );
  assert.equal(disallowed.status, 503);
  assert.equal((await jsonFrom(disallowed)).code, "helper_proxy_config_invalid");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: "https://other.example" } });
  try {
    const redirected = await workerModule.fetch(
      operatorRequest("https://dashboard.example/api/secopsai/triage-state"),
      hostedEnv({ SECOPSAI_HELPER_BASE_URL: "https://helper.example" }),
    );
    assert.equal(redirected.status, 502);
    assert.equal((await jsonFrom(redirected)).code, "helper_proxy_redirect");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testSuccessfulHelperProxyResponsesAreBounded() {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("x".repeat(5 * 1024 * 1024 + 1), {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
    const oversized = await workerModule.fetch(
      operatorRequest("https://dashboard.example/api/secopsai/triage-state"),
      hostedEnv({ SECOPSAI_HELPER_BASE_URL: "https://helper.example" }),
    );
    assert.equal(oversized.status, 502);
    assert.equal((await jsonFrom(oversized)).code, "helper_response_too_large");

    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: { bounded: true } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const valid = await workerModule.fetch(
      operatorRequest("https://dashboard.example/api/secopsai/triage-state"),
      hostedEnv({ SECOPSAI_HELPER_BASE_URL: "https://helper.example" }),
    );
    assert.equal(valid.status, 200);
    assert.deepEqual(await jsonFrom(valid), { ok: true, result: { bounded: true } });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testR2RunOutputResponsesAreBounded() {
  const response = await workerModule.fetch(
    operatorRequest("https://dashboard.example/api/run-output?path=jobs%2Foversized.txt"),
    hostedEnv({
      RUN_OUTPUTS: {
        async get() {
          return {
            size: 5 * 1024 * 1024 + 1,
            async text() {
              return "x";
            },
          };
        },
      },
    }),
  );
  assert.equal(response.status, 502);
  assert.equal((await jsonFrom(response)).code, "run_output_too_large");
}

async function testHostedOntologyProxyContract() {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const env = hostedEnv({
    SECOPSAI_CORE_API_URL: "https://core.example",
    SECOPSAI_CORE_READ_TOKEN: "read-token",
    SECOPSAI_CORE_INTELLIGENCE_TOKEN: "intelligence-token",
  });
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      schema_version: "secopsai.ontology.v1",
      entities: [{ entity_id: "pkg:pypi:example", entity_type: "package" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const search = await workerModule.fetch(
      operatorRequest("https://dashboard.example/api/secopsai/ontology/search/?q=example&limit=25"),
      env,
    );
    assert.equal(search.status, 200);
    assert.deepEqual((await jsonFrom(search)).entities[0].entity_id, "pkg:pypi:example");
    assert.equal(calls[0].url, "https://core.example/api/v1/ontology/search?q=example&limit=25");
    assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Bearer read-token");

    calls.length = 0;
    const detail = await workerModule.fetch(
      operatorRequest("https://dashboard.example/api/secopsai/ontology/entities/finding:test:F-1!*/"),
      env,
    );
    assert.equal(detail.status, 200);
    assert.equal(calls[0].url, "https://core.example/api/v1/ontology/entities/finding:test:F-1!*");
    assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Bearer read-token");

    calls.length = 0;
    const risk = await workerModule.fetch(
      operatorRequest("https://dashboard.example/api/secopsai/ontology/entities/finding:test:F-1/risk/"),
      env,
    );
    assert.equal(risk.status, 200);
    assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Bearer intelligence-token");

    globalThis.fetch = async () => new Response(JSON.stringify({ code: "route_not_found", error: "missing route" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
    const unavailable = await workerModule.fetch(
      operatorRequest("https://dashboard.example/api/secopsai/ontology/search"),
      env,
    );
    assert.equal(unavailable.status, 503);
    assert.equal((await jsonFrom(unavailable)).code, "core_ontology_route_unavailable");

    // Core's canonical error contract uses `error: "not_found"` (with a
    // human detail only for some failures), so exercise that exact shape.
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "not_found", detail: "entity missing" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
    const missing = await workerModule.fetch(
      operatorRequest("https://dashboard.example/api/secopsai/ontology/entities/finding:test:F-404"),
      env,
    );
    assert.equal(missing.status, 404);
    assert.equal((await jsonFrom(missing)).code, "ontology_entity_not_found");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

await testStaticAssetsAreAllowlisted();
await testAnonymousOperatorProfilesAreRejected();
await testContentPackWritesRequireAndForwardActionToken();
await testHostedHelperProxyRequiresAnHttpsOriginAndRejectsRedirects();
await testSuccessfulHelperProxyResponsesAreBounded();
await testR2RunOutputResponsesAreBounded();
await testHostedOntologyProxyContract();

console.log("dashboard security worker contract: ok");
