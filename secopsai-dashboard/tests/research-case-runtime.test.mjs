import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

class FakeElement {
  constructor(id) {
    this.id = id;
    this.innerHTML = '';
    this.value = '';
    this.hidden = false;
    this.dataset = {};
    this.classList = {
      add() {},
      remove() {},
      toggle() {},
    };
  }

  addEventListener() {}
  querySelectorAll() { return []; }
  querySelector() { return null; }
  closest() { return null; }
  scrollIntoView() {}
  focus() {}
}

function loadDashboardRuntime() {
  const elements = new Map();
  const storage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  };
  const document = {
    hidden: false,
    body: {
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {},
    },
    documentElement: { scrollTop: 0 },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    createElement(id) { return new FakeElement(id); },
  };
  const window = {
    __SECOPSAI_CONFIG: {},
    addEventListener() {},
    removeEventListener() {},
    location: { search: '', hash: '', pathname: '/' },
  };
  const context = {
    window,
    document,
    location: window.location,
    sessionStorage: storage,
    localStorage: storage,
    MutationObserver: class { observe() {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
    setInterval() { return 0; },
    clearInterval() {},
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    FormData,
    Blob,
    Intl,
    Date,
    Math,
    JSON,
    encodeURIComponent,
    decodeURIComponent,
    parseInt,
    parseFloat,
    isNaN,
    Number,
    String,
    Boolean,
    Object,
    Array,
    RegExp,
    Error,
    Promise,
    Map,
    Set,
    WeakMap,
    WeakSet,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(appSource, context, { filename: 'app.js' });
  return { context, elements };
}

function sampleCase(overrides = {}) {
  return {
    case_id: 'RSC-RUNTIME',
    title: 'Runtime rendering fixture',
    summary: 'A safe dashboard rendering fixture.',
    status: 'investigating',
    case_type: 'package',
    severity: 'critical',
    potential_impact: 'critical',
    confidence: 90,
    detection_confidence: 90,
    investigation_priority: 'high',
    local_exposure: 'unknown',
    publication_readiness: {
      ready: false,
      blockers: ['Independent review is pending.'],
      warnings: [],
      checked_at: '2026-08-29T00:00:00Z',
    },
    publication_readiness_state: 'blocked',
    evidence: [],
    artifacts: [],
    subjects: [],
    jobs: [],
    publication_reviews: [],
    disclosures: [],
    sandbox_requests: [],
    pipelines: [],
    iocs: [],
    ioc_candidates: [],
    observations: [],
    rules: [],
    rule_proposals: [],
    findings: [],
    timeline: [],
    ...overrides,
  };
}

const runtime = loadDashboardRuntime();
runtime.context.renderResearchCaseDetail(sampleCase());
const blockedHtml = runtime.elements.get('research-case-detail').innerHTML;
assert.match(blockedHtml, /Case assessment/);
assert.match(blockedHtml, /Potential impact/);
assert.match(blockedHtml, /Independent review is pending/);
assert.doesNotMatch(blockedHtml, /\[object Object\]/i);

runtime.context.renderResearchCaseDetail(sampleCase({
  publication_readiness: 'ready',
  publication_readiness_state: 'ready',
  artifacts: [{ artifact_id: 'ART-RUNTIME', filename: 'fixture.zip', state: 'quarantined', ecosystem: 'npm', package_name: 'fixture', version: '1.0.0', sha256: 'a'.repeat(64) }],
}));
const readyHtml = runtime.elements.get('research-case-detail').innerHTML;
assert.match(readyHtml, /Publication ready/);
assert.match(readyHtml, /Artifact catalog state is linked/);
assert.doesNotMatch(readyHtml, /ReferenceError|\[object Object\]/i);

console.log('research case runtime rendering checks passed');
