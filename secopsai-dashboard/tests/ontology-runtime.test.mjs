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
assert.match(html, /id=["']page-ontology["']/);
for (const id of ["ontology-search-section", "ontology-entity-section", "ontology-neighbors-section", "ontology-timeline-section", "ontology-risk-section", "ontology-quality-section"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing Mission Control surface ${id}`);
}
assert.match(worker, /async function handleHostedOntology\(/);
assert.match(worker, /SECOPSAI_CORE_INTELLIGENCE_TOKEN/);
assert.ok(worker.includes("entities\\/[A-Za-z0-9@:%._~+%-]+"));
assert.match(worker, /url\.pathname\.startsWith\(["']\/api\/secopsai\/ontology\//);

console.log("ontology runtime contract: ok");
