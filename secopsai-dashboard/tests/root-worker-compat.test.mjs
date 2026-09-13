import assert from "node:assert/strict";
import rootWorker from "../../_worker.js";

const forwarded = [];
const env = {
  ASSETS: {
    async fetch(request) {
      forwarded.push(new URL(request.url).pathname);
      return new Response("asset", { status: 200 });
    },
  },
};

for (const path of [
  "/",
  "/index.html",
  "/app.js",
  "/url-safety.js",
  "/styles.css",
  "/secopsai-dashboard/",
  "/secopsai-dashboard/index.html",
  "/secopsai-dashboard/url-safety.js",
]) {
  const response = await rootWorker.fetch(new Request(`https://dashboard.example${path}`), env);
  assert.equal(response.status, 200, path);
}

assert.deepEqual(forwarded, [
  "/secopsai-dashboard/",
  "/secopsai-dashboard/",
  "/secopsai-dashboard/app.js",
  "/secopsai-dashboard/url-safety.js",
  "/secopsai-dashboard/styles.css",
  "/secopsai-dashboard/",
  "/secopsai-dashboard/index.html",
  "/secopsai-dashboard/url-safety.js",
]);

const config = await rootWorker.fetch(new Request("https://dashboard.example/secopsai-dashboard/config.js"), {
  ...env,
  DASHBOARD_AUTH_REQUIRED: "false",
});
assert.equal(config.status, 200);
assert.match(await config.text(), /window\.SECOPSAI_CONFIG/);

const api = await rootWorker.fetch(new Request("https://dashboard.example/secopsai-dashboard/api/secopsai/ontology/search"), {
  ...env,
  DASHBOARD_AUTH_REQUIRED: "false",
});
assert.equal(api.status, 501);
assert.equal((await api.json()).error, "SECOPSAI_CORE_API_URL is not configured");

console.log("repository-root Pages compatibility contract: ok");
