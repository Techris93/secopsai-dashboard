import dashboardWorker from "./secopsai-dashboard/_worker.js";

const DASHBOARD_ASSET_ROOT = "/secopsai-dashboard";
const ROOT_ASSET_PATHS = new Set([
  "/app.js",
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

    return dashboardWorker.fetch(request, env, ctx);
  },
};
