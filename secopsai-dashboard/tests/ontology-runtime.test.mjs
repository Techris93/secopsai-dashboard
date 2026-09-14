import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(root, name), "utf8");
const app = read("app.js");
const worker = read("_worker.js");
const html = read("index.html");
// config.js is generated from local secrets and intentionally ignored. The
// template is the source of truth available in CI and must contain the same
// public route contract.
const config = read("config.template.js");

assert.match(config, /ontologyEndpoint:\s*["']\/api\/secopsai\/ontology/);
assert.match(app, /function fetchOntology\(/);
assert.match(app, /fetchOntology\(`?\/search/);
assert.match(app, /fetchOntology\(`?\/entities/);
assert.match(app, /fetchOntology\(['"]\/quality/);
assert.match(app, /riskError/);
assert.match(app, /Degraded · last known data/);
assert.match(app, /searchRequestId/);
assert.match(app, /entityRequestId/);
assert.match(app, /const selectionRequestId = state\.ontology\.entityRequestId/);
assert.match(app, /selectionChangedWhileSearching/);
assert.match(app, /if \(!isCurrent\(\)\) return state\.ontology\.results/);
assert.match(app, /if \(!isCurrent\(\)\) return null/);
assert.match(app, /panelStates/);
assert.match(app, /panelErrors/);
assert.match(app, /resetOntologyPanels\('loading'\)/);
assert.match(app, /The connected source did not return this panel/);
assert.match(app, /state\.ontology\.quality = null/);
assert.match(app, /panelUnavailable/);
assert.match(html, /id=["']page-ontology["']/);
for (const id of ["ontology-search-section", "ontology-entity-section", "ontology-neighbors-section", "ontology-timeline-section", "ontology-risk-section", "ontology-quality-section"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing Mission Control surface ${id}`);
}
assert.match(worker, /async function handleHostedOntology\(/);
assert.match(worker, /SECOPSAI_CORE_INTELLIGENCE_TOKEN/);
assert.ok(worker.includes("const match = suffix.match"));
assert.match(worker, /function hostedOntologySuffix\(/);
assert.match(worker, /core_ontology_route_unavailable/);
assert.match(worker, /ontology_entity_not_found/);
assert.match(worker, /url\.pathname\.startsWith\(["']\/api\/secopsai\/ontology\//);


const startScript = read("start-local-dashboard-stack.sh");
assert.match(startScript, /\/api\/healthz/, "start-local-dashboard-stack.sh must probe healthz");
assert.match(startScript, /kill -TERM/, "start-local-dashboard-stack.sh must send SIGTERM");
assert.match(startScript, /kill -9/, "start-local-dashboard-stack.sh must force kill stale helper");
assert.match(startScript, /curl -fsS .*\/api\/healthz/, "startup must require a successful health response");
assert.match(startScript, /token is intentionally not printed/, "startup must not print the local bearer token");
assert.match(startScript, /Dashboard is ready and healthy/, "start-local-dashboard-stack.sh must confirm healthy status");

const serverSource = read("dashboard_server.py");
assert.match(serverSource, /sys\.path\.insert\(0, str\(SECOPSAI_ROOT\)\)/, "dashboard_server.py must resolve SECOPSAI_ROOT");
assert.match(serverSource, /ontology_entity_not_found/, "dashboard_server.py must return typed ontology_entity_not_found");
assert.match(serverSource, /ontology_route_not_found/, "dashboard_server.py must return typed ontology_route_not_found");

assert.match(app, /The requested ontology entity was not found in the connected workspace/);
assert.match(app, /The requested ontology endpoint route was not found/);
assert.match(app, /Local dashboard authentication required/);
assert.match(app, /Cannot connect to the dashboard backend/);

console.log("ontology runtime contract: ok");
