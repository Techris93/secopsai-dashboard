import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import workerModule from "../_worker.js";
import { resetAccessKeyCache } from "../data-api.js";

const TEAM = "secopsai.cloudflareaccess.com";
const AUD = "test-audience-tag";

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const keyPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)), kid: "k1", alg: "RS256" };

async function accessJwt(claims = {}, { key = keyPair.privateKey, kid = "k1" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    aud: [AUD], iss: `https://${TEAM}`, email: "operator@example.com", sub: "user-1", iat: now, nbf: now - 5, exp: now + 300, ...claims,
  }));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

// Minimal D1 facade over node:sqlite, running the real migration.
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../d1_migrations/0001_dashboard.sql", import.meta.url), "utf8"));
  const statement = (sql, values = []) => ({
    bind: (...args) => statement(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    run: async () => { db.prepare(sql).run(...values); return { success: true }; },
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => Promise.all(statements.map((item) => item.all())),
  };
}

function env(overrides = {}) {
  return {
    DASHBOARD_AUTH_REQUIRED: "true",
    CF_ACCESS_TEAM_DOMAIN: TEAM,
    CF_ACCESS_AUD: AUD,
    DASHBOARD_OPERATOR_EMAILS: "operator@example.com",
    ACCESS_CERTS_FETCHER: { fetch: async () => Response.json({ keys: [publicJwk] }) },
    DASHBOARD_DB: d1(),
    ...overrides,
  };
}

async function call(path, { token, method = "GET", body, environment } = {}) {
  const headers = new Headers();
  if (token) headers.set("Cf-Access-Jwt-Assertion", token);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await workerModule.fetch(
    new Request(`https://console.secopsai.dev${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    environment,
  );
  return { status: response.status, payload: await response.json().catch(() => null), headers: response.headers };
}

async function testAccessTokensAreVerified() {
  resetAccessKeyCache();
  const environment = env();
  assert.equal((await call("/api/session", { environment })).status, 401);
  const ok = await call("/api/session", { token: await accessJwt(), environment });
  assert.equal(ok.status, 200);
  assert.equal(ok.payload.email, "operator@example.com");

  const otherKey = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign"],
  );
  assert.equal((await call("/api/session", { token: await accessJwt({}, { key: otherKey.privateKey }), environment })).status, 401, "forged signature");
  assert.equal((await call("/api/session", { token: await accessJwt({ aud: ["other-app"] }), environment })).status, 401, "wrong audience");
  assert.equal((await call("/api/session", { token: await accessJwt({ iss: "https://evil.cloudflareaccess.com" }), environment })).status, 401, "wrong issuer");
  assert.equal((await call("/api/session", { token: await accessJwt({ exp: Math.floor(Date.now() / 1000) - 600 }), environment })).status, 401, "expired");
  const stranger = await call("/api/session", { token: await accessJwt({ email: "stranger@example.net" }), environment });
  assert.equal(stranger.status, 403, "authenticated by Access but not an operator");
}

async function testDataApiRoundTripsWithTypeConversion() {
  resetAccessKeyCache();
  const environment = env();
  const token = await accessJwt();
  const created = await call("/api/data/work_items", {
    token, method: "POST", environment,
    body: { title: "Review work-boost@0.5.7", domain: "security", external_facing: true },
  });
  assert.equal(created.status, 200);
  const item = created.payload.data[0];
  assert.match(item.id, /^[0-9a-f-]{36}$/);
  assert.equal(item.external_facing, true);
  assert.equal(item.status, "inbox");

  const updated = await call(`/api/data/work_items?eq.id=${item.id}`, { token, method: "PATCH", environment, body: { status: "review" } });
  assert.equal(updated.payload.data[0].status, "review");

  const listed = await call("/api/data/work_items?select=id,title,status&order=updated_at.desc&limit=5", { token, environment });
  assert.deepEqual(listed.payload.data.map((row) => row.status), ["review"]);

  const finding = await call("/api/data/findings", {
    token, method: "POST", environment,
    body: {
      external_finding_id: "SCX-1", source: "openclaw", source_platform: "openclaw", title: "t", summary: "s", severity: "high",
      severity_score: 80, confidence: "high", rule_id: "R1", rule_name: "Rule", detected_at: "2026-10-09T00:00:00Z",
      first_seen_at: "2026-10-09T00:00:00Z", last_seen_at: "2026-10-09T00:00:00Z", event_ids: ["E1", "E2"], risk_tags: ["exfil"],
    },
  });
  assert.deepEqual(finding.payload.data[0].event_ids, ["E1", "E2"]);

  assert.equal((await call(`/api/data/work_items?eq.id=${item.id}`, { token, method: "DELETE", environment })).status, 200);
  assert.deepEqual((await call("/api/data/work_items", { token, environment })).payload.data, []);
}

async function testDataApiRejectsUnsafeInput() {
  resetAccessKeyCache();
  const environment = env();
  const token = await accessJwt();
  assert.equal((await call("/api/data/pg_catalog", { token, environment })).status, 404);
  assert.equal((await call("/api/data/work_items?order=title;DROP TABLE work_items", { token, environment })).status, 400);
  assert.equal((await call("/api/data/work_items?select=title,password", { token, environment })).status, 400);
  assert.equal((await call("/api/data/work_items", { token, method: "DELETE", environment })).status, 400, "unfiltered delete");
  assert.equal((await call("/api/data/work_items", { token, method: "POST", environment, body: { title: "x", domain: "security", is_admin: 1 } })).status, 400);
}

async function testAccessModeConfigAndCsp() {
  const configResponse = await workerModule.fetch(new Request("https://console.secopsai.dev/config.js"), env({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon" }));
  const config = await configResponse.text();
  assert.match(config, /"mode": "access"/);
  assert.match(config, /"dataBackend": "worker"/);
  assert.doesNotMatch(config, /supabase\.co/);
  const csp = configResponse.headers.get("Content-Security-Policy");
  assert.doesNotMatch(csp, /supabase|jsdelivr/);
}

await testAccessTokensAreVerified();
await testDataApiRoundTripsWithTypeConversion();
await testDataApiRejectsUnsafeInput();
await testAccessModeConfigAndCsp();
console.log("access + D1 worker contract: ok");
