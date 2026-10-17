import dashboardWorker from "./secopsai-dashboard/_worker.js";

const DASHBOARD_ASSET_ROOT = "/secopsai-dashboard";
const ROOT_ASSET_PATHS = new Set([
  "/index.html",
  "/favicon.svg",
  "/app.js",
  "/url-safety.js",
  "/styles.css",
  "/radar-texture.png",
  "/log-agent-run.html",
  "/view-run-output.html",
]);

function rewriteAssetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url.toString(), request);
}

function isAssetMethod(method) {
  return method === "GET" || method === "HEAD";
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (isAssetMethod(request.method) && (url.pathname === "/" || url.pathname === "/index.html")) {
      return env.ASSETS.fetch(rewriteAssetRequest(request, `${DASHBOARD_ASSET_ROOT}/`));
    }

    if (isAssetMethod(request.method) && ROOT_ASSET_PATHS.has(url.pathname)) {
      return env.ASSETS.fetch(rewriteAssetRequest(request, `${DASHBOARD_ASSET_ROOT}${url.pathname}`));
    }

    if (url.pathname === `${DASHBOARD_ASSET_ROOT}/config.js` || url.pathname.startsWith(`${DASHBOARD_ASSET_ROOT}/api/`)) {
      const delegatedPath = url.pathname.slice(DASHBOARD_ASSET_ROOT.length) || "/";
      return dashboardWorker.fetch(rewriteAssetRequest(request, delegatedPath), env, ctx);
    }

    // Keep the repository-root deployment compatible with the nested Pages
    // output used by the release workflow.  The shell references its assets
    // with absolute URLs, while direct links may still include the folder.
    if (isAssetMethod(request.method) && (url.pathname === DASHBOARD_ASSET_ROOT || url.pathname.startsWith(`${DASHBOARD_ASSET_ROOT}/`))) {
      const relativePath = url.pathname.slice(DASHBOARD_ASSET_ROOT.length) || "/";
      if (relativePath === "/" || ROOT_ASSET_PATHS.has(relativePath)) {
        return env.ASSETS.fetch(rewriteAssetRequest(request, `${DASHBOARD_ASSET_ROOT}${relativePath}`));
      }
    }

    return dashboardWorker.fetch(request, env, ctx);
  },
};
