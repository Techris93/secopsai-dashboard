// Cloudflare-native operator auth and data plane for Mission Control.
//
// - Cloudflare Access authenticates the operator at the edge; the Worker
//   verifies the Access JWT (RS256, audience, issuer, expiry) on every API
//   request instead of trusting a header blindly.
// - Dashboard tables live in D1.  The API supports the narrow query surface
//   app.js uses (select/order/limit/eq, insert, update, delete) with column
//   allowlists, so no SQL or identifiers come from the browser unchecked.

const TEXT = "text";
const BOOL = "bool";
const INT = "int";
const JSON_TYPE = "json";

function columns(text, types = {}) {
  const map = {};
  for (const name of text) map[name] = TEXT;
  return { ...map, ...types };
}

export const TABLES = {
  agent_runs: columns([
    "id", "run_group_id", "role_label", "runtime", "model_used", "task_summary", "task_detail", "status",
    "source_surface", "source_channel_id", "source_message_id", "initiated_by", "parent_run_id", "output_path",
    "output_summary", "error_summary", "started_at", "completed_at", "created_at",
  ]),
  work_items: columns([
    "id", "title", "description", "domain", "owner_role", "reviewer_role", "priority", "status", "source_surface",
    "source_channel_id", "source_message_id", "linked_run_id", "due_date", "created_by", "created_at", "updated_at",
  ], { external_facing: BOOL, requires_security_review: BOOL }),
  channel_routes: columns([
    "id", "provider", "server_id", "channel_id", "channel_name", "default_role_label", "created_at",
  ], { allow_orchestrator_override: BOOL, post_summaries: BOOL, post_run_logs: BOOL, active: BOOL }),
  dashboard_events: columns([
    "id", "event_type", "title", "body", "severity", "related_run_id", "related_work_item_id", "created_at",
  ]),
  run_requests: columns([
    "id", "created_at", "updated_at", "status", "role_label", "prompt_text", "suggested_channel_name",
    "related_work_item_id", "related_run_id", "initiated_by", "output_summary", "output_path", "error",
  ]),
  findings: columns([
    "id", "external_finding_id", "source", "source_platform", "correlation_type", "detection_layer", "title",
    "summary", "severity", "confidence", "status", "disposition", "rule_id", "rule_name", "source_name", "detector",
    "fingerprint", "dedupe_key", "mitre", "detected_at", "first_seen_at", "last_seen_at", "created_at", "updated_at",
    "resolved_at", "actor_user", "actor_process", "actor_ip", "actor_host", "target_user", "target_resource",
    "target_resource_type", "target_path", "persistence_category", "execution_category", "assigned_to",
    "analyst_notes", "parent_finding_id", "work_item_id", "related_work_item_id", "run_id",
  ], {
    severity_score: INT, event_count: INT, mitre_ids: JSON_TYPE, event_ids: JSON_TYPE, affected_users: JSON_TYPE,
    affected_processes: JSON_TYPE, affected_hosts: JSON_TYPE, risk_tags: JSON_TYPE, evidence: JSON_TYPE,
    recommended_actions: JSON_TYPE, raw_payload: JSON_TYPE, correlated_finding_ids: JSON_TYPE, metadata: JSON_TYPE,
  }),
};

const MAX_LIMIT = 500;
const MAX_BODY_BYTES = 1024 * 1024;

export class DataApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function toDb(type, value) {
  if (value === undefined || value === null) return null;
  if (type === BOOL) return value ? 1 : 0;
  if (type === INT) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new DataApiError(400, "invalid_value", "Expected a number");
    return Math.trunc(number);
  }
  if (type === JSON_TYPE) return JSON.stringify(value);
  return String(value);
}

function fromDb(table, row) {
  const schema = TABLES[table];
  const result = {};
  for (const [name, value] of Object.entries(row)) {
    const type = schema[name];
    if (type === BOOL) result[name] = value === null ? null : Boolean(value);
    else if (type === JSON_TYPE && typeof value === "string") {
      try { result[name] = JSON.parse(value); } catch { result[name] = null; }
    } else result[name] = value;
  }
  return result;
}

function requireTable(name) {
  if (!Object.prototype.hasOwnProperty.call(TABLES, name)) throw new DataApiError(404, "unknown_table", "Unknown table");
  return TABLES[name];
}

function requireColumn(schema, name) {
  if (!Object.prototype.hasOwnProperty.call(schema, name)) throw new DataApiError(400, "unknown_column", `Unknown column: ${String(name).slice(0, 64)}`);
  return name;
}

function filters(schema, params) {
  const clauses = [];
  const values = [];
  for (const [key, value] of params) {
    if (!key.startsWith("eq.")) continue;
    const column = requireColumn(schema, key.slice(3));
    clauses.push(`"${column}" = ?`);
    values.push(toDb(schema[column], schema[column] === BOOL ? value === "true" : value));
  }
  return { where: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", values };
}

function rowValues(schema, payload, { insert }) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new DataApiError(400, "invalid_row", "Expected an object");
  const now = new Date().toISOString();
  const row = { ...payload };
  if (insert) {
    if (schema.id && !row.id) row.id = crypto.randomUUID();
    if (schema.created_at && !row.created_at) row.created_at = now;
  }
  if (schema.updated_at && !row.updated_at) row.updated_at = now;
  const names = Object.keys(row).map((name) => requireColumn(schema, name));
  return { names, values: names.map((name) => toDb(schema[name], row[name])) };
}

async function readJson(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new DataApiError(413, "payload_too_large", "Request body is too large");
  try {
    return JSON.parse(text || "null");
  } catch {
    throw new DataApiError(400, "invalid_json", "Request body must be JSON");
  }
}

export async function handleDataRequest(request, db, table) {
  if (!db || typeof db.prepare !== "function") throw new DataApiError(503, "data_backend_unavailable", "Dashboard data store is not configured");
  const schema = requireTable(table);
  const url = new URL(request.url);
  const { where, values } = filters(schema, url.searchParams);

  if (request.method === "GET") {
    const select = (url.searchParams.get("select") || "*").split(",").map((item) => item.trim()).filter(Boolean);
    const projection = select.includes("*") ? "*" : select.map((name) => `"${requireColumn(schema, name)}"`).join(", ");
    let sql = `SELECT ${projection} FROM "${table}"${where}`;
    const order = url.searchParams.get("order");
    if (order) {
      const [column, direction] = order.split(".");
      sql += ` ORDER BY "${requireColumn(schema, column)}" ${direction === "asc" ? "ASC" : "DESC"}`;
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "200", 10) || 200));
    sql += ` LIMIT ${limit}`;
    const result = await db.prepare(sql).bind(...values).all();
    return (result.results || []).map((row) => fromDb(table, row));
  }

  if (request.method === "POST") {
    const payload = await readJson(request);
    const rows = Array.isArray(payload) ? payload : [payload];
    if (!rows.length || rows.length > 100) throw new DataApiError(400, "invalid_rows", "Insert between 1 and 100 rows");
    const statements = rows.map((row) => {
      const { names, values: rowVals } = rowValues(schema, row, { insert: true });
      const sql = `INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")}) RETURNING *`;
      return db.prepare(sql).bind(...rowVals);
    });
    const results = await db.batch(statements);
    return results.flatMap((result) => (result.results || []).map((row) => fromDb(table, row)));
  }

  if (!where) throw new DataApiError(400, "filter_required", "Updates and deletes require an eq.<column> filter");

  if (request.method === "PATCH") {
    const { names, values: rowVals } = rowValues(schema, await readJson(request), { insert: false });
    if (!names.length) throw new DataApiError(400, "empty_update", "Nothing to update");
    const sql = `UPDATE "${table}" SET ${names.map((name) => `"${name}" = ?`).join(", ")}${where} RETURNING *`;
    const result = await db.prepare(sql).bind(...rowVals, ...values).all();
    return (result.results || []).map((row) => fromDb(table, row));
  }

  if (request.method === "DELETE") {
    await db.prepare(`DELETE FROM "${table}"${where}`).bind(...values).run();
    return [];
  }

  throw new DataApiError(405, "method_not_allowed", "Method not allowed");
}

// ---------------------------------------------------------------------------
// Cloudflare Access
// ---------------------------------------------------------------------------

const jwksCache = new Map();
const JWKS_TTL_MS = 60 * 60 * 1000;

export function accessConfigured(env) {
  return Boolean(String(env.CF_ACCESS_TEAM_DOMAIN || "").trim() && String(env.CF_ACCESS_AUD || "").trim());
}

function teamOrigin(env) {
  const raw = String(env.CF_ACCESS_TEAM_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const host = raw.includes(".") ? raw : `${raw}.cloudflareaccess.com`;
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(host)) throw new Error("CF_ACCESS_TEAM_DOMAIN must be <team>.cloudflareaccess.com");
  return `https://${host}`;
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function accessToken(request) {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header) return header.trim();
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function signingKey(env, kid, fetcher) {
  const origin = teamOrigin(env);
  let cached = jwksCache.get(origin);
  if (!cached || cached.expires < Date.now() || !cached.keys.has(kid)) {
    const response = await fetcher(`${origin}/cdn-cgi/access/certs`, { redirect: "manual" });
    if (!response.ok) throw new Error("Access certificates are unavailable");
    const { keys = [] } = await response.json();
    cached = { expires: Date.now() + JWKS_TTL_MS, keys: new Map(keys.map((key) => [key.kid, key])) };
    jwksCache.set(origin, cached);
  }
  const jwk = cached.keys.get(kid);
  if (!jwk) throw new Error("Unknown Access signing key");
  return crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

// Returns the verified identity or null.  Never throws for a bad token.
export async function verifyAccessRequest(request, env, fetcher = (input, init) => fetch(input, init)) {
  const token = accessToken(request);
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    if (header.alg !== "RS256" || !header.kid) return null;
    const key = await signingKey(env, header.kid, fetcher);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(String(env.CF_ACCESS_AUD).trim())) return null;
    if (claims.iss !== teamOrigin(env)) return null;
    if (!Number.isFinite(claims.exp) || claims.exp < now - 30) return null;
    if (Number.isFinite(claims.nbf) && claims.nbf > now + 30) return null;
    const email = String(claims.email || "").trim().toLowerCase();
    if (!email) return null;
    return { id: String(claims.sub || ""), email, email_confirmed_at: new Date(Number(claims.iat || now) * 1000).toISOString(), source: "cloudflare_access" };
  } catch {
    return null;
  }
}

export function resetAccessKeyCache() {
  jwksCache.clear();
}
