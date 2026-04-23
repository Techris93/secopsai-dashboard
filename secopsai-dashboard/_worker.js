const DEFAULT_APP_NAME = "SecOpsAI Mission Control";
const DEFAULT_SERVER_ID = "1484917962245668874";
const DEFAULT_RUN_OUTPUT_PROXY_PATH = "/api/run-output";
const DEFAULT_RUN_OUTPUTS_BINDING = "RUN_OUTPUTS";
const DEFAULT_RUN_OUTPUT_R2_PREFIX = "";
const DEFAULT_HOSTED_AI_MODEL = "gpt-5.4-mini";
const DEFAULT_HOSTED_AI_MAX_COST_USD = 3;
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
  return {
    supabaseUrl: env.SUPABASE_URL || "",
    supabaseAnonKey: env.SUPABASE_ANON_KEY || "",
    appName: env.APP_NAME || DEFAULT_APP_NAME,
    serverId: env.DISCORD_SERVER_ID || DEFAULT_SERVER_ID,
    discordNotifyEndpoint: "/api/discord-notify",
    integrationStatusEndpoint: "/api/integration-status",
    runOutputEndpoint: DEFAULT_RUN_OUTPUT_PROXY_PATH,
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
    },
    ai_guard: aiGuard,
  });
}

async function proxySecopsaiHelper(request, env) {
  const baseUrl = String(env.SECOPSAI_HELPER_BASE_URL || "").trim();
  if (!baseUrl) {
    return jsonResponse(
      {
        ok: false,
        error: "SecOpsAI helper is not configured for hosted mode. Set SECOPSAI_HELPER_BASE_URL.",
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

  const init = {
    method: request.method,
    headers,
  };

  if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
    init.body = await request.text();
  }

  const response = await fetch(upstreamUrl.toString(), init);
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

async function handleDiscordNotify(request, env) {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/config.js") {
      return jsResponse(buildConfigScript(env));
    }

    if (request.method === "GET" && url.pathname === "/api/integration-status") {
      return handleIntegrationStatus(env);
    }

    if (url.pathname.startsWith("/api/secopsai/")) {
      return proxySecopsaiHelper(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/run-output") {
      return handleRunOutput(request, env);
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
  },
};
