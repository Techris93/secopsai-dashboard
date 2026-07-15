const DEFAULT_APP_NAME = "SecOpsAI Mission Control";
const DEFAULT_SERVER_ID = "1484917962245668874";
const DEFAULT_RUN_OUTPUT_PROXY_PATH = "/api/run-output";
const DEFAULT_RUN_OUTPUTS_BINDING = "RUN_OUTPUTS";
const DEFAULT_RUN_OUTPUT_R2_PREFIX = "";
const DEFAULT_HOSTED_AI_MODEL = "gpt-5.4-mini";
const DEFAULT_HOSTED_AI_MAX_COST_USD = 3;
const DEFAULT_BLOG_OPS_OWNER = "Techris93";
const DEFAULT_BLOG_OPS_REPO = "secopsai";
const DEFAULT_BLOG_OPS_WORKFLOW = "blog-ops.yml";
const MAX_OPERATOR_PROFILE_BYTES = 64 * 1024;
const MAX_SECOPSAI_WORKSPACE_BYTES = 5 * 1024 * 1024;
const EDGE_OPERATIONS_RESOURCES = {
  sites: ["/api/v1/sites", "list"],
  sensors: ["/api/v1/sensors", "list"],
  schedules: ["/api/v1/scan-schedules", "list"],
  scan_jobs: ["/api/v1/scan-jobs", "list"],
  credential: ["/api/v1/integration-tokens/self", "object"],
};
const DASHBOARD_DEPARTMENTS = {
  exec: "#06B6D4",
  platform: "#3B82F6",
  security: "#8B5CF6",
  product: "#6366F1",
  revenue: "#F59E0B",
  support: "#10B981",
};
const DASHBOARD_ROLE_GROUPS = {
  exec: ["exec/agents-orchestrator"],
  platform: [
    "platform/software-architect",
    "platform/backend-architect",
    "platform/ai-engineer",
    "platform/devops-automator",
  ],
  security: [
    "security/security-engineer",
    "security/threat-detection-engineer",
  ],
  product: [
    "product/product-manager",
    "product/ui-designer",
  ],
  revenue: [
    "revenue/content-creator",
    "revenue/outbound-strategist",
    "revenue/sales-engineer",
  ],
  support: ["support/support-responder"],
};
const ALLOWED_DISCORD_CHANNELS = new Set(["ops-log", "kanban-updates"]);
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "font-src 'self' https://fonts.gstatic.com",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "img-src 'self' data: https:",
  "object-src 'none'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "upgrade-insecure-requests",
].join("; ");

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(payload, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  });
}

function jsResponse(source, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/javascript; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(source, {
    ...init,
    headers,
  });
}

function buildBrowserConfig(env) {
  const authRequired = truthyEnv(env.DASHBOARD_AUTH_REQUIRED, true);
  return {
    // Never hand browser-readable database credentials to an auth-disabled
    // deployment. The static app renders a locked rollout state instead.
    supabaseUrl: authRequired ? env.SUPABASE_URL || "" : "",
    supabaseAnonKey: authRequired ? env.SUPABASE_ANON_KEY || "" : "",
    appName: env.APP_NAME || DEFAULT_APP_NAME,
    serverId: env.DISCORD_SERVER_ID || DEFAULT_SERVER_ID,
    discordNotifyEndpoint: "/api/discord-notify",
    integrationStatusEndpoint: "/api/integration-status",
    runOutputEndpoint: DEFAULT_RUN_OUTPUT_PROXY_PATH,
    blogOpsEndpoint: "/api/blog",
    triageOpsEndpoint: "/api/secopsai/triage-ops",
    researchCasesEndpoint: "/api/secopsai/research-cases",
    researchWatchlistEndpoint: "/api/secopsai/research-watchlist",
    edgeWorkspaceEndpoint: "/api/secopsai/edge-workspace",
    edgeDashboardUrl: String(env.SECOPSAI_EDGE_DASHBOARD_URL || "").trim(),
    auth: {
      required: authRequired,
      mode: authRequired ? "operator" : "locked",
    },
    aiGuard: buildAiGuard(env),
    departments: DASHBOARD_DEPARTMENTS,
    roleGroups: DASHBOARD_ROLE_GROUPS,
  };
}

function buildConfigScript(env) {
  const payload = buildBrowserConfig(env);
  return `window.SECOPSAI_CONFIG = ${JSON.stringify(payload, null, 2)};\n`;
}

function trimToLength(value, maxLength = 1800) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function sanitizeHelperErrorDetail(value, maxLength = 900) {
  return trimToLength(String(value || "")
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[redacted-github-token]")
    .replace(/(token|secret|password|key)(["':=\s]+)[^"'\s,}]+/gi, "$1$2[redacted]")
    .replace(/\s+/g, " ")
    .trim(), maxLength);
}

function parseJsonBody(request) {
  return request.json().catch(() => null);
}

function truthyEnv(value, fallback = false) {
  if (typeof value === "undefined" || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function numberEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasProtectedDashboardBackend(env) {
  return Boolean(getRunOutputBinding(env) || [
    env.SECOPSAI_CORE_API_URL,
    env.SECOPSAI_CORE_READ_TOKEN,
    env.SECOPSAI_EDGE_API_URL,
    env.SECOPSAI_EDGE_OPERATIONS_TOKEN,
    env.SECOPSAI_EDGE_ADMIN_TOKEN,
    env.SECOPSAI_HELPER_BASE_URL,
    env.SECOPSAI_HELPER_AUTH_TOKEN,
    env.BLOG_OPS_GITHUB_TOKEN,
    env.RUN_OUTPUT_BASE_URL,
    env.RUN_OUTPUT_AUTH_TOKEN,
  ].some(value => String(value || "").trim()));
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  const token = authorization.slice(7).trim();
  return token.length <= 4096 ? token : "";
}

function serviceBaseUrl(value, label, { requireSupabaseHost = false } = {}) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be an HTTPS origin without credentials, query parameters, or fragments`);
  }
  if (requireSupabaseHost && !url.hostname.endsWith(".supabase.co")) {
    throw new Error(`${label} must use a Supabase project origin`);
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url;
}

async function boundedJson(response, maxBytes, label) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error(`${label} exceeded the response size limit`);
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error(`${label} exceeded the response size limit`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

async function timedFetch(fetcher, input, init = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requireDashboardOperator(request, env) {
  if (!truthyEnv(env.DASHBOARD_AUTH_REQUIRED, true)) {
    if (hasProtectedDashboardBackend(env)) {
      return jsonResponse(
        {
          ok: false,
          code: "operator_auth_required",
          error: "Dashboard backend access is disabled until operator authentication is enabled.",
        },
        { status: 503 },
      );
    }
    return null;
  }

  const token = bearerToken(request);
  if (!token) {
    return jsonResponse({ ok: false, code: "operator_session_required", error: "Operator session required" }, { status: 401 });
  }

  const anonKey = String(env.SUPABASE_ANON_KEY || "").trim();
  let supabaseUrl;
  try {
    supabaseUrl = serviceBaseUrl(env.SUPABASE_URL, "SUPABASE_URL", { requireSupabaseHost: true });
  } catch {
    return jsonResponse({ ok: false, code: "operator_auth_unavailable", error: "Operator authentication is unavailable" }, { status: 503 });
  }
  if (!anonKey) {
    return jsonResponse({ ok: false, code: "operator_auth_unavailable", error: "Operator authentication is unavailable" }, { status: 503 });
  }

  const userUrl = new URL("/auth/v1/user", supabaseUrl);
  const authRequest = new Request(userUrl.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
    redirect: "manual",
  });
  let response;
  try {
    const authFetcher = env.SUPABASE_AUTH_FETCHER;
    const fetcher = authFetcher && typeof authFetcher.fetch === "function"
      ? (input, init) => authFetcher.fetch(input, init)
      : (input, init) => fetch(input, init);
    response = await timedFetch(fetcher, authRequest, {}, 8000);
  } catch {
    return jsonResponse({ ok: false, code: "operator_auth_unavailable", error: "Operator authentication is unavailable" }, { status: 503 });
  }
  if (!response.ok) {
    return jsonResponse({ ok: false, code: "operator_session_invalid", error: "Operator session is invalid or expired" }, { status: 401 });
  }
  try {
    const profile = await boundedJson(response, MAX_OPERATOR_PROFILE_BYTES, "Operator profile");
    if (!profile || typeof profile !== "object" || !String(profile.id || "").trim()) {
      throw new Error("Operator profile is incomplete");
    }
  } catch {
    return jsonResponse({ ok: false, code: "operator_session_invalid", error: "Operator session is invalid or expired" }, { status: 401 });
  }
  return null;
}

async function secopsaiApiJson(baseUrl, path, token, label) {
  const url = new URL(path, baseUrl);
  const response = await timedFetch((input, init) => fetch(input, init), url.toString(), {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    redirect: "manual",
  }, 12000);
  if (response.status >= 300 && response.status < 400) throw new Error(`${label} refused an upstream redirect`);
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return boundedJson(response, MAX_SECOPSAI_WORKSPACE_BYTES, label);
}

function unavailableCore(error, configured = false) {
  return {
    configured,
    ok: false,
    error,
    assets: [],
    findings: [],
    changes: { nodes: [], edges: [] },
    sites: [],
    sensors: [],
    services: [],
    wifi_networks: [],
    sync_state: [],
  };
}

async function loadHostedCoreWorkspace(env) {
  const rawUrl = String(env.SECOPSAI_CORE_API_URL || "").trim();
  const token = String(env.SECOPSAI_CORE_READ_TOKEN || "").trim();
  if (!rawUrl || !token) {
    return unavailableCore("Set SECOPSAI_CORE_API_URL and SECOPSAI_CORE_READ_TOKEN to load the canonical Core workspace.");
  }
  try {
    const baseUrl = serviceBaseUrl(rawUrl, "SECOPSAI_CORE_API_URL");
    const payload = await secopsaiApiJson(baseUrl, "/api/v1/workspace?limit=500", token, "SecOpsAI Core API");
    if (!payload || typeof payload !== "object" || payload.schema_version !== "secopsai.core.workspace.v1") {
      throw new Error("SecOpsAI Core API returned an unsupported workspace schema");
    }
    return { ...payload, configured: true, ok: true };
  } catch (error) {
    return unavailableCore(sanitizeHelperErrorDetail(error?.message || error), true);
  }
}

function unavailableEdge(error, configured = false) {
  return {
    configured,
    ok: false,
    error,
    sites: [],
    sensors: [],
    schedules: [],
    scan_jobs: [],
  };
}

async function loadHostedEdgeOperations(env) {
  const rawUrl = String(env.SECOPSAI_EDGE_API_URL || "").trim();
  const token = String(env.SECOPSAI_EDGE_OPERATIONS_TOKEN || "").trim();
  if (!rawUrl || !token) {
    return unavailableEdge("Set SECOPSAI_EDGE_API_URL and SECOPSAI_EDGE_OPERATIONS_TOKEN to load live sensor operations.");
  }
  let baseUrl;
  try {
    baseUrl = serviceBaseUrl(rawUrl, "SECOPSAI_EDGE_API_URL");
  } catch (error) {
    return unavailableEdge(sanitizeHelperErrorDetail(error?.message || error), true);
  }

  const result = { configured: true, ok: true, credential_scope: "operations:read" };
  const failures = [];
  await Promise.all(Object.entries(EDGE_OPERATIONS_RESOURCES).map(async ([key, [path, expected]]) => {
    try {
      const payload = await secopsaiApiJson(baseUrl, path, token, `SecOpsAI Edge ${key}`);
      const valid = expected === "list" ? Array.isArray(payload) : payload && typeof payload === "object" && !Array.isArray(payload);
      if (!valid) throw new Error(`SecOpsAI Edge ${key} returned an invalid response`);
      result[key] = payload;
    } catch (error) {
      result[key] = expected === "list" ? [] : {};
      if (key === "credential") {
        result.warning = "Live Edge operations are available, but credential expiry could not be verified.";
      } else {
        failures.push(sanitizeHelperErrorDetail(error?.message || error));
      }
    }
  }));

  if (result.credential?.rotation_recommended) {
    result.warning = `Edge operations credential expires in ${Number(result.credential.expires_in_days || 0)} day(s). Rotate it before expiry.`;
  }
  if (failures.length) {
    result.ok = false;
    result.error = failures.sort().join(" ");
  }
  return result;
}

async function handleHostedCoreEdgeWorkspace(env) {
  const [core, edge] = await Promise.all([
    loadHostedCoreWorkspace(env),
    loadHostedEdgeOperations(env),
  ]);
  return jsonResponse(
    {
      ok: core.ok,
      generated_at: new Date().toISOString(),
      source: "hosted-core-edge",
      core,
      edge,
    },
    { status: core.ok ? 200 : 503 },
  );
}

function blogOpsConfig(env) {
  return {
    owner: String(env.BLOG_OPS_OWNER || DEFAULT_BLOG_OPS_OWNER).trim() || DEFAULT_BLOG_OPS_OWNER,
    repo: String(env.BLOG_OPS_REPO || DEFAULT_BLOG_OPS_REPO).trim() || DEFAULT_BLOG_OPS_REPO,
    workflow: String(env.BLOG_OPS_WORKFLOW || DEFAULT_BLOG_OPS_WORKFLOW).trim() || DEFAULT_BLOG_OPS_WORKFLOW,
    ref: String(env.BLOG_OPS_REF || "main").trim() || "main",
    token: String(env.BLOG_OPS_GITHUB_TOKEN || env.GITHUB_TOKEN || "").trim(),
    adminToken: String(env.BLOG_OPS_ADMIN_TOKEN || "").trim(),
  };
}

function blogOpsPublicStatus(env) {
  const config = blogOpsConfig(env);
  return {
    owner: config.owner,
    repo: config.repo,
    workflow: config.workflow,
    ref: config.ref,
    mode: "hosted-github-actions",
    github_configured: Boolean(config.token),
    admin_token_configured: Boolean(config.adminToken),
    capabilities: {
      github_actions: Boolean(config.token),
      workflow_history: Boolean(config.token),
      local_cli: false,
      deploy: Boolean(config.token),
    },
  };
}

function isBlogOpsAdmin(request, env) {
  const expected = blogOpsConfig(env).adminToken;
  if (!expected) return false;
  const direct = request.headers.get("x-blog-ops-admin-token") || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  return direct === expected || bearer === expected;
}

function requireBlogOpsAdmin(request, env) {
  const config = blogOpsConfig(env);
  if (!config.adminToken) {
    return jsonResponse(
      {
        ok: false,
        error: "Blog Ops admin token is not configured. Set BLOG_OPS_ADMIN_TOKEN.",
        code: "not_configured",
      },
      { status: 501 },
    );
  }
  if (!isBlogOpsAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "Unauthorized Blog Ops action" }, { status: 401 });
  }
  return null;
}

function triageOpsExpectedAdminToken(env) {
  return String(env.TRIAGE_OPS_ADMIN_TOKEN || env.BLOG_OPS_ADMIN_TOKEN || "").trim();
}

function requireTriageOpsAdmin(request, env) {
  const expected = triageOpsExpectedAdminToken(env);
  if (!expected) {
    return jsonResponse(
      {
        ok: false,
        error: "Triage Ops admin token is not configured. Set TRIAGE_OPS_ADMIN_TOKEN or BLOG_OPS_ADMIN_TOKEN.",
        code: "not_configured",
      },
      { status: 501 },
    );
  }
  const direct = request.headers.get("x-triage-ops-admin-token") || "";
  const fallback = request.headers.get("x-blog-ops-admin-token") || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (![direct, fallback, bearer].includes(expected)) {
    return jsonResponse({ ok: false, error: "Unauthorized Triage Ops action" }, { status: 401 });
  }
  return null;
}

function isTriageOpsWriteRoute(request, pathname) {
  if (request.method.toUpperCase() !== "POST") return false;
  if (pathname.startsWith("/api/secopsai/research-cases/")) return true;
  const action = pathname.split("/").filter(Boolean).pop() || "";
  return ["close", "escalate", "create-blog-draft", "campaign-persist-findings", "campaign-blog-draft", "campaign-watchlist"].includes(action);
}

function blogOpsNotConfigured(env) {
  const config = blogOpsConfig(env);
  if (config.token) return null;
  return jsonResponse(
    {
      ok: false,
      error: "Blog Ops GitHub token is not configured. Set BLOG_OPS_GITHUB_TOKEN.",
      code: "not_configured",
      config: blogOpsPublicStatus(env),
    },
    { status: 501 },
  );
}

async function githubRequest(env, path, init = {}) {
  const config = blogOpsConfig(env);
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "User-Agent": "secopsai-dashboard-blog-ops",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const message = payload?.message || `GitHub API HTTP ${response.status}`;
    if (response.status === 404) {
      const config = blogOpsConfig(env);
      throw new Error(
        `${message}. Check BLOG_OPS_OWNER=${config.owner}, BLOG_OPS_REPO=${config.repo}, BLOG_OPS_WORKFLOW=${config.workflow}, BLOG_OPS_REF=${config.ref}, and make sure BLOG_OPS_GITHUB_TOKEN has access to that repository with Actions read/write permission.`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`${message}. Check BLOG_OPS_GITHUB_TOKEN validity and GitHub Actions/Contents permissions.`);
    }
    throw new Error(message);
  }
  return payload;
}

function decodeBase64Content(value) {
  const compact = String(value || "").replace(/\s+/g, "");
  if (!compact) return "";
  return atob(compact);
}

function summarizeBlogDraft(path, post) {
  const readinessBlockers = Array.isArray(post.readiness_blockers) ? post.readiness_blockers.slice(0, 12) : [];
  const readinessWarnings = Array.isArray(post.readiness_warnings) ? post.readiness_warnings.slice(0, 12) : [];
  const extracted = post.extracted && typeof post.extracted === "object" ? post.extracted : {};
  return {
    path,
    slug: String(post.slug || path.split("/").pop()?.replace(/\.json$/, "") || ""),
    title: String(post.title || "Untitled draft"),
    summary: String(post.summary || "").slice(0, 260),
    source_name: String(post.source_name || post.author || "SecOpsAI"),
    severity: String(post.severity || "info"),
    review_status: String(post.review_status || "needs_review"),
    categories: Array.isArray(post.categories) ? post.categories.slice(0, 10) : [],
    sources: Array.isArray(post.sources) ? post.sources.slice(0, 8) : Array.isArray(post.references) ? post.references.slice(0, 8) : [],
    updated_at: String(post.updated_at || post.reviewed_at || post.fetched_at || ""),
    external_news: Boolean(post.external_news),
    readiness_score: Number(post.readiness_score || 0),
    readiness_status: String(post.readiness_status || ""),
    readiness_blockers: readinessBlockers,
    readiness_warnings: readinessWarnings,
    extracted,
    media_candidates: Array.isArray(post.media_candidates) ? post.media_candidates.slice(0, 8) : [],
    images: Array.isArray(post.images) ? post.images.slice(0, 8) : [],
    source_metadata: {
      canonical_url: post.canonical_url || "",
      source_url: post.source_url || "",
      source_trust_level: post.source_trust_level || "",
      source_category: post.source_category || "",
      fetched_at: post.fetched_at || "",
      published_at: post.published_at || "",
    },
    review_checklist: Array.isArray(post.review_checklist) ? post.review_checklist.slice(0, 12) : [],
  };
}

function blogDraftIsApproved(draft) {
  return ["approved", "reviewed"].includes(String(draft?.review_status || ""));
}

function blogDraftBlockers(draft) {
  return Array.isArray(draft?.readiness_blockers)
    ? draft.readiness_blockers.filter((item) => String(item || "").trim())
    : [];
}

function blogDraftIsPublishable(draft) {
  return blogDraftIsApproved(draft) && String(draft?.readiness_status || "").toLowerCase() !== "blocked" && blogDraftBlockers(draft).length === 0;
}

function clampLimit(value, fallback = 50, max = 50) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

async function mapInBatches(items, batchSize, mapper) {
  const results = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    results.push(...(await Promise.all(batch.map(mapper))));
  }
  return results;
}

async function loadBlogDrafts(env, options = {}) {
  const config = blogOpsConfig(env);
  const limit = clampLimit(options.limit, 50, 50);
  let entries = [];
  try {
    entries = await githubRequest(env, `/repos/${config.owner}/${config.repo}/contents/blog/drafts?ref=${encodeURIComponent(config.ref)}`);
  } catch (error) {
    if (String(error.message || "").includes("Not Found")) return [];
    throw error;
  }
  if (!Array.isArray(entries)) return [];
  const jsonFiles = entries.filter((entry) => entry?.type === "file" && String(entry.name || "").endsWith(".json"));
  const drafts = await mapInBatches(jsonFiles.slice(0, limit), 8, async (entry) => {
    try {
      const file = await githubRequest(env, `/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(entry.path).replaceAll("%2F", "/")}?ref=${encodeURIComponent(config.ref)}`);
      const post = JSON.parse(decodeBase64Content(file.content));
      return summarizeBlogDraft(entry.path, post);
    } catch (error) {
      return {
        path: entry.path,
        slug: String(entry.name || "").replace(/\.json$/, ""),
        title: String(entry.name || "Unreadable draft"),
        summary: `Unable to parse draft metadata: ${error.message}`,
        source_name: "GitHub",
        severity: "unknown",
        review_status: "error",
        categories: [],
        sources: [],
        external_news: true,
      };
    }
  });
  return drafts.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
}

async function loadBlogDraft(env, identifier) {
  const config = blogOpsConfig(env);
  const drafts = await loadBlogDrafts(env);
  const normalized = String(identifier || "").replace(/\.json$/, "");
  const match = drafts.find((draft) =>
    draft.slug === normalized ||
    draft.path === identifier ||
    draft.path.endsWith(`/${identifier}`) ||
    draft.slug.includes(normalized)
  );
  if (!match) return null;
  const file = await githubRequest(env, `/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(match.path).replaceAll("%2F", "/")}?ref=${encodeURIComponent(config.ref)}`);
  const post = JSON.parse(decodeBase64Content(file.content));
  return {
    ...summarizeBlogDraft(match.path, post),
    body_markdown: String(post.body_markdown || ""),
    references: Array.isArray(post.references) ? post.references.slice(0, 12) : [],
    primary_references: Array.isArray(post.primary_references) ? post.primary_references.slice(0, 8) : [],
    source_links: Array.isArray(post.source_links) ? post.source_links.slice(0, 12) : [],
    media_candidates: Array.isArray(post.media_candidates) ? post.media_candidates.slice(0, 8) : [],
    images: Array.isArray(post.images) ? post.images.slice(0, 8) : [],
    review_note: String(post.review_note || ""),
  };
}

async function loadBlogSourceCount(env) {
  const config = blogOpsConfig(env);
  try {
    const file = await githubRequest(env, `/repos/${config.owner}/${config.repo}/contents/blog/data/news-sources.json?ref=${encodeURIComponent(config.ref)}`);
    const payload = JSON.parse(decodeBase64Content(file.content));
    const sources = Array.isArray(payload?.sources) ? payload.sources : [];
    return {
      total: sources.length,
      enabled: sources.filter((source) => source?.enabled !== false).length,
    };
  } catch {
    return { total: null, enabled: null };
  }
}

async function loadBlogWorkflowRuns(env) {
  const config = blogOpsConfig(env);
  const payload = await githubRequest(
    env,
    `/repos/${config.owner}/${config.repo}/actions/workflows/${encodeURIComponent(config.workflow)}/runs?per_page=8`,
  );
  return Array.isArray(payload?.workflow_runs)
    ? payload.workflow_runs.map((run) => ({
        id: run.id,
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        event: run.event,
        branch: run.head_branch,
        created_at: run.created_at,
        updated_at: run.updated_at,
        html_url: run.html_url,
      }))
    : [];
}

async function dispatchBlogWorkflow(env, inputs) {
  const config = blogOpsConfig(env);
  await githubRequest(
    env,
    `/repos/${config.owner}/${config.repo}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({
        ref: config.ref,
        inputs,
      }),
    },
  );
  return {
    ok: true,
    dispatched: true,
    workflow: config.workflow,
    ref: config.ref,
    action: inputs.action,
  };
}

async function handleBlogOps(request, env) {
  const url = new URL(request.url);
  const configStatus = blogOpsPublicStatus(env);
  const notConfigured = blogOpsNotConfigured(env);
  const path = url.pathname.replace(/^\/api\/blog\/?/, "");
  const parts = path.split("/").filter(Boolean);

  if (request.method === "GET" && (!path || path === "status")) {
    const draftLimit = clampLimit(url.searchParams.get("limit"), 50, 50);
    if (notConfigured) {
      return jsonResponse({ ok: true, configured: false, config: configStatus, drafts: [], runs: [] });
    }
    const [drafts, runs, sources] = await Promise.all([
      loadBlogDrafts(env, { limit: draftLimit }).catch((error) => ({ error: error.message, items: [] })),
      loadBlogWorkflowRuns(env).catch((error) => ({ error: error.message, items: [] })),
      loadBlogSourceCount(env),
    ]);
    const draftItems = Array.isArray(drafts) ? drafts : drafts.items;
    const runItems = Array.isArray(runs) ? runs : runs.items;
    return jsonResponse({
      ok: true,
      configured: true,
      config: configStatus,
      drafts: draftItems,
      runs: runItems,
      errors: {
        drafts: Array.isArray(drafts) ? null : drafts.error,
        runs: Array.isArray(runs) ? null : runs.error,
      },
      counts: {
        sources: sources.enabled ?? sources.total,
        drafts: draftItems.length,
        needs_review: draftItems.filter((draft) => draft.review_status === "needs_review").length,
        approved: draftItems.filter(blogDraftIsApproved).length,
        approved_publishable: draftItems.filter(blogDraftIsPublishable).length,
        approved_blocked: draftItems.filter((draft) => blogDraftIsApproved(draft) && !blogDraftIsPublishable(draft)).length,
        deployed: draftItems.filter((draft) => ["deployed", "published"].includes(draft.review_status)).length,
        rejected: draftItems.filter((draft) => draft.review_status === "rejected").length,
      },
    });
  }

  if (notConfigured) return notConfigured;

  if (request.method === "GET" && path === "drafts") {
    return jsonResponse({ ok: true, drafts: await loadBlogDrafts(env, { limit: url.searchParams.get("limit") }) });
  }

  if (request.method === "GET" && parts[0] === "drafts" && parts[1]) {
    const draft = await loadBlogDraft(env, decodeURIComponent(parts.slice(1).join("/")));
    if (!draft) return jsonResponse({ ok: false, error: "Draft not found" }, { status: 404 });
    return jsonResponse({ ok: true, draft });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Unsupported Blog Ops route" }, { status: 404 });
  }

  const authFailure = requireBlogOpsAdmin(request, env);
  if (authFailure) return authFailure;

  const body = (await parseJsonBody(request)) || {};
  const limit = String(Number(body.limit || url.searchParams.get("limit") || 5) || 5);
  const note = trimToLength(body.note || "", 500);

  const actionMap = {
    "news-run": "news-run",
    "news-fetch": "news-fetch",
    "news-draft": "news-draft",
    "publish-approved": "publish-approved",
    "rebuild-feeds": "rebuild-feeds",
    deploy: "deploy",
  };

  if (actionMap[path]) {
    const payload = await dispatchBlogWorkflow(env, { action: actionMap[path], limit });
    return jsonResponse(payload, { status: 202 });
  }

  if (parts[0] === "drafts" && parts[1] && parts[2] === "save") {
    const payload = await dispatchBlogWorkflow(env, {
      action: "save-draft",
      draft: decodeURIComponent(parts.slice(1, -1).join("/")),
      note,
      limit,
      title: trimToLength(body.title || "", 240),
      summary: trimToLength(body.summary || "", 1600),
      severity: trimToLength(body.severity || "", 20),
      categories: trimToLength(Array.isArray(body.categories) ? body.categories.join(", ") : body.categories || "", 1200),
      references: trimToLength(Array.isArray(body.references) ? body.references.join("\n") : body.references || "", 2400),
      body_markdown: trimToLength(body.body_markdown || "", 60000),
    });
    return jsonResponse(payload, { status: 202 });
  }

  if (parts[0] === "drafts" && parts[1] && ["approve", "reject", "needs-review"].includes(parts[2])) {
    const action = parts[2] === "needs-review" ? "needs-review" : parts[2];
    const payload = await dispatchBlogWorkflow(env, {
      action,
      draft: decodeURIComponent(parts.slice(1, -1).join("/")),
      note,
      limit,
    });
    return jsonResponse(payload, { status: 202 });
  }

  return jsonResponse({ ok: false, error: "Unsupported Blog Ops action" }, { status: 404 });
}

function buildAiGuard(env) {
  return {
    hostedEnabled: truthyEnv(env.HOSTED_AI_ENABLED, false),
    defaultModel: String(env.HOSTED_AI_MODEL || DEFAULT_HOSTED_AI_MODEL).trim() || DEFAULT_HOSTED_AI_MODEL,
    maxCostUsd: numberEnv(env.HOSTED_AI_MAX_COST_USD, DEFAULT_HOSTED_AI_MAX_COST_USD),
    allowMutations: truthyEnv(env.HOSTED_AI_ALLOW_MUTATIONS, false),
  };
}

function getDiscordWebhookForChannel(env, channel) {
  if (channel === "ops-log") return env.DISCORD_OPS_LOG_WEBHOOK || "";
  if (channel === "kanban-updates") return env.DISCORD_KANBAN_UPDATES_WEBHOOK || "";
  return "";
}

function discordNotifyToken(env) {
  return String(env.DISCORD_NOTIFY_TOKEN || "").trim();
}

function requireDiscordNotifyToken(request, env) {
  const expected = discordNotifyToken(env);
  if (!expected) {
    return jsonResponse(
      {
        ok: false,
        error: "Discord notify token is not configured. Set DISCORD_NOTIFY_TOKEN before enabling /api/discord-notify.",
        code: "not_configured",
      },
      { status: 501 },
    );
  }
  const direct = request.headers.get("x-discord-notify-token") || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (![direct, bearer].includes(expected)) {
    return jsonResponse({ ok: false, error: "Unauthorized Discord notify action" }, { status: 401 });
  }
  return null;
}

function getRunOutputBinding(env) {
  const bindingName = (env.RUN_OUTPUT_R2_BINDING || DEFAULT_RUN_OUTPUTS_BINDING).trim();
  const binding = bindingName ? env[bindingName] : null;
  if (!binding || typeof binding.get !== "function") return null;
  return binding;
}

function joinKey(prefix, relPath) {
  const cleanPrefix = String(prefix || DEFAULT_RUN_OUTPUT_R2_PREFIX).replace(/^\/+|\/+$/g, "");
  if (!cleanPrefix) return relPath;
  return `${cleanPrefix}/${relPath}`;
}

function sanitizeRelativePath(input) {
  const value = String(input || "").replace(/\\/g, "/").trim();
  if (!value) return null;
  if (value.startsWith("/")) return null;
  const parts = value.split("/").filter(Boolean);
  if (!parts.length) return null;
  for (const part of parts) {
    if (part === "." || part === "..") return null;
  }
  return parts.join("/");
}

function extractDiscordErrorDetail(rawText, httpStatus) {
  const detail = {
    http_status: httpStatus,
    raw: rawText || "",
  };
  if (!rawText) return detail;
  try {
    const parsed = JSON.parse(rawText);
    detail.parsed = parsed;
    if (parsed && typeof parsed.code !== "undefined") {
      detail.discord_code = parsed.code;
    }
  } catch {
    const match = rawText.match(/error code:\s*(\d+)/i);
    if (match) {
      detail.discord_code = Number(match[1]);
    }
  }
  return detail;
}

async function proxyRunOutputFromUpstream(relPath, env) {
  const baseUrl = String(env.RUN_OUTPUT_BASE_URL || "").trim();
  if (!baseUrl) return null;

  const url = new URL(baseUrl);
  url.searchParams.set("path", relPath);

  const headers = new Headers();
  const authHeader = String(env.RUN_OUTPUT_AUTH_HEADER || "").trim();
  const authToken = String(env.RUN_OUTPUT_AUTH_TOKEN || "").trim();
  if (authHeader && authToken) {
    headers.set(authHeader, authToken);
  }

  const resp = await fetch(url.toString(), { headers });
  const bodyText = await resp.text();
  const contentType = resp.headers.get("content-type") || "";

  if (!resp.ok) {
    let message = `Upstream run output HTTP ${resp.status}`;
    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText);
        message = parsed.error || parsed.message || message;
      } catch {
        message = bodyText.slice(0, 300) || message;
      }
    }
    return jsonResponse(
      {
        ok: false,
        error: message,
        upstream_status: resp.status,
      },
      { status: resp.status },
    );
  }

  if (contentType.includes("application/json")) {
    let parsed = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === "object" && "ok" in parsed) {
      return jsonResponse(parsed, { status: resp.status });
    }
  }

  return jsonResponse({
    ok: true,
    text: bodyText,
    source: "upstream",
  });
}

async function handleIntegrationStatus(env) {
  const runOutputBinding = getRunOutputBinding(env);
  const runOutputProxy = String(env.RUN_OUTPUT_BASE_URL || "").trim();
  const secopsaiHelperBase = String(env.SECOPSAI_HELPER_BASE_URL || "").trim();
  const aiGuard = buildAiGuard(env);
  const blogOpsStatus = blogOpsPublicStatus(env);
  return jsonResponse({
    ok: true,
    discord: {
      mode: "cloudflare-pages",
      "ops-log": Boolean(env.DISCORD_OPS_LOG_WEBHOOK),
      "kanban-updates": Boolean(env.DISCORD_KANBAN_UPDATES_WEBHOOK),
    },
    run_output: {
      mode: runOutputBinding ? "r2" : runOutputProxy ? "proxy" : "disabled",
      configured: Boolean(runOutputBinding || runOutputProxy),
    },
    helper: {
      mode: secopsaiHelperBase ? "upstream-proxy" : "cloudflare-pages",
      secopsai_triage_api: Boolean(secopsaiHelperBase),
      secopsai_sessions_api: Boolean(secopsaiHelperBase),
      secopsai_research_api: Boolean(secopsaiHelperBase),
      secopsai_campaign_api: Boolean(secopsaiHelperBase),
      secopsai_events_api: Boolean(secopsaiHelperBase),
      secopsai_edge_api: Boolean(secopsaiHelperBase),
    },
    core: {
      mode: String(env.SECOPSAI_CORE_API_URL || "").trim() ? "hosted-api" : "disabled",
      configured: Boolean(String(env.SECOPSAI_CORE_API_URL || "").trim() && String(env.SECOPSAI_CORE_READ_TOKEN || "").trim()),
    },
    edge_operations: {
      mode: String(env.SECOPSAI_EDGE_API_URL || "").trim() ? "hosted-api" : "disabled",
      configured: Boolean(String(env.SECOPSAI_EDGE_API_URL || "").trim() && String(env.SECOPSAI_EDGE_OPERATIONS_TOKEN || "").trim()),
    },
    blog_ops: {
      mode: blogOpsStatus.mode,
      configured: Boolean(blogOpsStatus.github_configured),
      capabilities: blogOpsStatus.capabilities,
    },
    ai_guard: aiGuard,
  });
}

function helperUpstreamFailureCode(status, detail) {
  if (Number(status) === 530 && /(?:error code:\s*)?1033\b/i.test(String(detail || ""))) {
    return "helper_tunnel_unreachable";
  }
  return "helper_upstream_error";
}

function helperUpstreamFailureHint(status, detail) {
  if (Number(status) === 530 && /(?:error code:\s*)?1033\b/i.test(String(detail || ""))) {
    return "Cloudflare returned 1033 for the helper origin. Update SECOPSAI_HELPER_BASE_URL to a live helper/tunnel URL, or clear it and use local helper mode until the tunnel is restored.";
  }
  return "If this is hosted mode, confirm SECOPSAI_HELPER_BASE_URL points to a live helper/tunnel. If this is local mode, restart ./start-local-dashboard-stack.sh and retry Refresh evidence.";
}

async function proxySecopsaiHelper(request, env) {
  const baseUrl = String(env.SECOPSAI_HELPER_BASE_URL || "").trim();
  if (!baseUrl) {
    return jsonResponse(
      {
        ok: false,
        error: "SecOpsAI helper is not configured for hosted mode. Use local helper mode for helper-backed actions, or configure a live SECOPSAI_HELPER_BASE_URL intentionally.",
        code: "not_configured",
        hint: "Local helper mode runs at http://127.0.0.1:45680 after ./start-local-dashboard-stack.sh. Hosted dashboard no longer calls the retired secopsai-helper.secopsai.dev tunnel.",
      },
      { status: 501 },
    );
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(baseUrl);
  upstreamUrl.pathname = incomingUrl.pathname;
  upstreamUrl.search = incomingUrl.search;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const authHeader = String(env.SECOPSAI_HELPER_AUTH_HEADER || "").trim();
  const authToken = String(env.SECOPSAI_HELPER_AUTH_TOKEN || "").trim();
  if (authHeader && authToken) {
    headers.set(authHeader, authToken);
  }
  const triageOpsToken = request.headers.get("x-triage-ops-admin-token") || "";
  if (triageOpsToken && (
    incomingUrl.pathname.startsWith("/api/secopsai/triage-ops/")
    || incomingUrl.pathname.startsWith("/api/secopsai/research-cases/")
    || incomingUrl.pathname === "/api/secopsai/research-watchlist"
  )) {
    headers.set("X-Triage-Ops-Admin-Token", triageOpsToken);
  }

  const init = {
    method: request.method,
    headers,
  };

  if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
    init.body = await request.text();
  }

  let response;
  try {
    response = await fetch(upstreamUrl.toString(), init);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "SecOpsAI helper is unreachable. Start or restart the local dashboard helper, verify the Cloudflare Tunnel origin, then refresh Triage Ops.",
        code: "helper_unreachable",
        detail: sanitizeHelperErrorDetail(error?.message || error),
      },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    let upstreamPayload = null;
    try {
      upstreamPayload = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      upstreamPayload = null;
    }
    const upstreamError = upstreamPayload?.error || upstreamPayload?.message || bodyText || response.statusText || "helper request failed";
    const failureCode = helperUpstreamFailureCode(response.status, upstreamError);
    return jsonResponse(
      {
        ok: false,
        error: `SecOpsAI helper upstream HTTP ${response.status}: ${sanitizeHelperErrorDetail(upstreamError)}`,
        code: failureCode,
        upstream_status: response.status,
        hint: helperUpstreamFailureHint(response.status, upstreamError),
      },
      { status: response.status },
    );
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

async function handleDiscordNotify(request, env) {
  const authResponse = requireDiscordNotifyToken(request, env);
  if (authResponse) return authResponse;

  const payload = await parseJsonBody(request);
  if (!payload || typeof payload !== "object") {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const channel = payload.channel;
  if (!ALLOWED_DISCORD_CHANNELS.has(channel)) {
    return jsonResponse({ ok: false, error: "Unsupported channel" }, { status: 400 });
  }

  const content = trimToLength(payload.content);
  if (!content) {
    return jsonResponse({ ok: false, error: "Missing content" }, { status: 400 });
  }

  const webhook = getDiscordWebhookForChannel(env, channel);
  if (!webhook) {
    return jsonResponse({
      ok: false,
      skipped: true,
      reason: `No webhook configured for ${channel}`,
    });
  }

  const resp = await fetch(webhook, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });
  const bodyText = await resp.text();

  if (!resp.ok) {
    return jsonResponse(
      {
        ok: false,
        error: `Discord webhook HTTP ${resp.status}`,
        errorDetail: extractDiscordErrorDetail(bodyText, resp.status),
      },
      { status: 502 },
    );
  }

  return jsonResponse({
    ok: true,
    status: resp.status,
    response: bodyText || null,
  });
}

async function handleRunOutput(request, env) {
  const url = new URL(request.url);
  const relPath = sanitizeRelativePath(url.searchParams.get("path"));
  if (!relPath) {
    return jsonResponse({ ok: false, error: "Missing path" }, { status: 400 });
  }

  const runOutputBinding = getRunOutputBinding(env);
  if (runOutputBinding) {
    const key = joinKey(env.RUN_OUTPUT_R2_PREFIX, relPath);
    const object = await runOutputBinding.get(key);
    if (!object) {
      return jsonResponse({ ok: false, error: "File not found" }, { status: 404 });
    }
    const text = await object.text();
    return jsonResponse({
      ok: true,
      text,
      source: "r2",
      key,
    });
  }

  const proxyResponse = await proxyRunOutputFromUpstream(relPath, env);
  if (proxyResponse) return proxyResponse;

  return jsonResponse(
    {
      ok: false,
      error: "Run output is not configured for hosted mode. Add an R2 binding or RUN_OUTPUT_BASE_URL.",
    },
    { status: 501 },
  );
}

async function routeRequest(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/config.js") {
      return jsResponse(buildConfigScript(env));
    }

    if (request.method === "GET" && url.pathname === "/api/integration-status") {
      const authResponse = await requireDashboardOperator(request, env);
      if (authResponse) return authResponse;
      return handleIntegrationStatus(env);
    }

    if (url.pathname.startsWith("/api/secopsai/")) {
      const authResponse = await requireDashboardOperator(request, env);
      if (authResponse) return authResponse;
      if (request.method === "GET" && url.pathname === "/api/secopsai/edge-workspace") {
        const directHostedMode = Boolean([
          env.SECOPSAI_CORE_API_URL,
          env.SECOPSAI_CORE_READ_TOKEN,
          env.SECOPSAI_EDGE_API_URL,
          env.SECOPSAI_EDGE_OPERATIONS_TOKEN,
        ].some(value => String(value || "").trim()));
        if (directHostedMode) return handleHostedCoreEdgeWorkspace(env);
      }
      if (isTriageOpsWriteRoute(request, url.pathname)) {
        const writeAuthResponse = requireTriageOpsAdmin(request, env);
        if (writeAuthResponse) return writeAuthResponse;
      }
      if (request.method === "POST" && url.pathname === "/api/secopsai/research-watchlist") {
        // Preview is read-only; only draft-case creation needs the write token.
        const body = await request.clone().json().catch(() => ({}));
        if (String(body.action || "preview").trim().toLowerCase() === "create") {
          const writeAuthResponse = requireTriageOpsAdmin(request, env);
          if (writeAuthResponse) return writeAuthResponse;
        }
      }
      return proxySecopsaiHelper(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/run-output") {
      const authResponse = await requireDashboardOperator(request, env);
      if (authResponse) return authResponse;
      return handleRunOutput(request, env);
    }

    if (url.pathname === "/api/blog" || url.pathname.startsWith("/api/blog/")) {
      const authResponse = await requireDashboardOperator(request, env);
      if (authResponse) return authResponse;
      try {
        return await handleBlogOps(request, env);
      } catch (error) {
        return jsonResponse({ ok: false, error: error.message || "Blog Ops request failed" }, { status: 502 });
      }
    }

    if (request.method === "POST" && url.pathname === "/api/discord-notify") {
      return handleDiscordNotify(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/discord-send-message") {
      return jsonResponse(
        {
          ok: false,
          error: "Dashboard direct dispatch is retired. Use OpenClaw-native orchestrator flows instead.",
        },
        { status: 410 },
      );
    }

    return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    return withSecurityHeaders(await routeRequest(request, env));
  },
};
