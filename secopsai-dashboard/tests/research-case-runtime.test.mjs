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
assert.match(blockedHtml, /Evidence reliability workspace/);
for (const label of [
  'Generate Hypotheses', 'Rank Hypotheses', 'Run Scaffold Research', 'Verify Transition',
  'Run Full Safe Research', 'Build Claim Ledger', 'Verify Claims', 'Run Specialist',
  'Run Blind Review', 'Audit Completeness', 'Check Originality', 'Render Publication Preview',
  'Create Review-Only Draft', 'Publish Approved', 'Deploy',
]) assert.match(blockedHtml, new RegExp(label));
assert.equal((blockedHtml.match(/id="research-draft-blog-btn"/g) || []).length, 1);
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

runtime.context.renderResearchCaseDetail(sampleCase({
  research_reliability: {
    hypotheses: [{ hypothesis_type: 'malicious_compromise', statement: 'The exact artifact is compromised.', status: 'selected', rank: 1 }],
    plans: [{ revision: 1, status: 'active', intended_methods: ['registry_metadata'], executed_methods: ['registry_metadata'] }],
    run_bundles: [
      { stage: 'full', status: 'succeeded', completeness_score: 100, verification: { tamper_evident: true } },
      { stage: 'transition', status: 'succeeded', completeness_score: 100, verification: { tamper_evident: true } },
      { stage: 'scaffold', status: 'succeeded', completeness_score: 100, verification: { tamper_evident: true } },
    ],
    effective_claim_ledger: [{ text_span: 'The package is proc-macro1@1.0.107.', claim_type: 'package_version', support_status: 'supported', evidence_ids: ['EVD-RUNTIME'], contradicting_evidence: [] }],
    claim_ledger: [],
    specialist_review: { status: 'completed', material_disagreement: false, publication_blocked: false, run: { status: 'needs_review', result: {}, review: {}, profile_id: 'threat-intel' } },
    latest_audits: {
      completeness: { status: 'passed', score: 100, hard_blockers: [] },
      originality: { status: 'passed', score: 100, hard_blockers: [] },
      visual_qa: { status: 'passed', score: 100, hard_blockers: [] },
    },
    next_action: { action: 'publication_review', label: 'Run publication safety', reason: 'Reliability gates passed.' },
  },
}));
const reliabilityReadyHtml = runtime.elements.get('research-case-detail').innerHTML;
assert.match(reliabilityReadyHtml, /integrity verified/);
assert.match(reliabilityReadyHtml, /Reliability gates passed/);
assert.doesNotMatch(reliabilityReadyHtml, /ReferenceError|\[object Object\]/i);

runtime.context.renderResearchCaseDetail(sampleCase({
  research_reliability: {
    ...sampleCase().research_reliability,
    hypotheses: [{ hypothesis_type: 'malicious_compromise', statement: 'The exact artifact is compromised.', status: 'selected', rank: 1 }],
    plans: [{ revision: 1, status: 'active', intended_methods: ['registry_metadata'], executed_methods: ['registry_metadata'] }],
    run_bundles: [
      { stage: 'full', status: 'succeeded', completeness_score: 100, verification: { tamper_evident: true } },
      { stage: 'transition', status: 'succeeded', completeness_score: 100, verification: { tamper_evident: true } },
      { stage: 'scaffold', status: 'succeeded', completeness_score: 100, verification: { tamper_evident: true } },
    ],
    effective_claim_ledger: [{ text_span: 'The package is proc-macro1@1.0.107.', claim_type: 'package_version', support_status: 'supported', evidence_ids: ['EVD-RUNTIME'], contradicting_evidence: [] }],
    claim_ledger: [],
    specialist_review: {
      status: 'completed',
      material_disagreement: true,
      adjudication_status: 'pending_human',
      publication_blocked: true,
      run: { run_id: 'SOR-ABCDEF1234567890', status: 'needs_review', result: { output: { verdict_recommendation: 'credible' } }, review: { output: { verdict_recommendation: 'benign' } }, profile_id: 'threat-intel' },
    },
    latest_audits: {
      completeness: { status: 'passed', score: 100, hard_blockers: [] },
      originality: { status: 'passed', score: 100, hard_blockers: [] },
      visual_qa: { status: 'passed', score: 100, hard_blockers: [] },
    },
    next_action: { action: 'adjudicate_review', label: 'Adjudicate review disagreement', reason: 'A human decision is required.' },
  },
}));
const disagreementHtml = runtime.elements.get('research-case-detail').innerHTML;
assert.match(disagreementHtml, /Human adjudication required/);
assert.match(disagreementHtml, /Record adjudication/);
assert.match(disagreementHtml, /SOR-ABCDEF1234567890/);
assert.match(disagreementHtml, /Adjudicate review disagreement/);

runtime.context.renderResearchCaseDetail(sampleCase({
  research_reliability: {
    ...sampleCase().research_reliability,
    hypotheses: [{ hypothesis_type: 'malicious_compromise', statement: 'The exact artifact is compromised.', status: 'selected', rank: 1 }],
    plans: [{ revision: 1, status: 'active', intended_methods: ['registry_metadata'], executed_methods: ['registry_metadata'] }],
    run_bundles: [
      { stage: 'full', status: 'succeeded', completeness_score: 100, verification: { tamper_evident: true } },
      { stage: 'transition', status: 'succeeded', completeness_score: 100, verification: { tamper_evident: true } },
      { stage: 'scaffold', status: 'succeeded', completeness_score: 100, verification: { tamper_evident: true } },
    ],
    effective_claim_ledger: [{ text_span: 'The package is proc-macro1@1.0.107.', claim_type: 'package_version', support_status: 'supported', evidence_ids: ['EVD-RUNTIME'], contradicting_evidence: [] }],
    claim_ledger: [],
    specialist_review: {
      status: 'completed',
      material_disagreement: true,
      adjudication_status: 'resolved_reviewer',
      publication_blocked: false,
      run: { run_id: 'SOR-ABCDEF1234567890', status: 'needs_review', result: { output: { verdict_recommendation: 'credible' } }, review: { output: { verdict_recommendation: 'benign' } }, profile_id: 'threat-intel' },
    },
    latest_audits: {
      completeness: { status: 'passed', score: 100, hard_blockers: [] },
      originality: { status: 'passed', score: 100, hard_blockers: [] },
      visual_qa: { status: 'passed', score: 100, hard_blockers: [] },
    },
    next_action: { action: 'publication_review', label: 'Run publication safety', reason: 'Reliability gates passed.' },
  },
}));
const resolvedHtml = runtime.elements.get('research-case-detail').innerHTML;
assert.match(resolvedHtml, /Reliability gates passed/);
assert.match(resolvedHtml, /Resolved by reviewer/);
assert.doesNotMatch(resolvedHtml, /Human adjudication required/);

runtime.context.learningFixture = {
  learning: {
    settings: {
      minimum_precision: 0.9,
      maximum_false_negative_regression: 0,
    },
    summary: {
      feedback_total: 10846,
      examples: 2353,
      experiments: 100,
      proposals: 100,
      blocked: 99,
      shadow: 0,
      canary: 1,
      awaiting_adjudication: 4143,
      unknown_subjects: 6249,
      resolved_unknown_subjects: 2106,
      feedback_by_outcome: { unknown: 8490 },
      example_by_label: { true_positive: 2098, false_positive: 255 },
    },
    proposals: [{
      proposal_id: 'DLP-RUNTIME',
      proposal_type: 'risk_ranker',
      status: 'blocked',
      dataset_id: 'DLS-RUNTIME',
      guardrails: {
        enough_examples: true,
        both_labels: true,
        holdout_evaluable: true,
        precision_pass: false,
        false_negative_regression_pass: true,
      },
      parameters: { policy_fingerprint: 'fixture-policy' },
      replay_metrics: {
        evaluation_status: 'evaluated',
        holdout: {
          count: 479,
          tp: 429,
          fp: 50,
          tn: 0,
          fn: 0,
          precision: 0.8956158663883089,
          recall: 1,
          false_positive_rate: 1,
        },
      },
    }],
    adjudication_queue: [{
      subject_key: 'SCM-RUNTIME',
      finding_id: 'SCM-RUNTIME',
      evidence_ref_count: 2,
      active_features: ['severity', 'strong_signals'],
      created_at: '2026-08-29T00:00:00Z',
    }],
    deployments: [{
      deployment_id: 'DLD-RUNTIME',
      proposal_id: 'DLP-OLDER',
      stage: 'canary',
      traffic_percent: 10,
      status: 'running',
      started_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
      observations: { tp: 0, fp: 0, tn: 0, fn: 0 },
    }],
  },
};
vm.runInContext('state.intelligence.data = learningFixture; renderIntelligence();', runtime.context);
const learningCurrentHtml = runtime.elements.get('detection-learning-current').innerHTML;
const adjudicationHtml = runtime.elements.get('detection-learning-adjudication').innerHTML;
const learningHistoryHtml = runtime.elements.get('detection-learning-proposals').innerHTML;
const learningDeploymentsHtml = runtime.elements.get('detection-learning-deployments').innerHTML;
assert.match(learningCurrentHtml, /Rejected by safety guardrails/);
assert.match(learningCurrentHtml, /No production detector changed/);
assert.match(learningCurrentHtml, /89\.56%/);
assert.match(learningCurrentHtml, /100% false-positive rate and zero true negatives/);
assert.match(adjudicationHtml, /4143 distinct subjects still need an evidence-backed decision/);
assert.match(adjudicationHtml, /SCM-RUNTIME/);
assert.match(learningHistoryHtml, /Evaluation history/);
assert.match(learningDeploymentsHtml, /Stale evaluation/);
assert.match(learningDeploymentsHtml, /Stop and retain audit/);
assert.doesNotMatch(learningCurrentHtml + adjudicationHtml + learningHistoryHtml + learningDeploymentsHtml, /ReferenceError|\[object Object\]/i);

const busyBridgeFixture = {
  mode: 'local-helper',
  bridge: {
    status: 'busy',
    busy: true,
    live_ready: true,
    health_stale: false,
    selected_model: 'xai/grok-4.6',
    active_model: 'xai/grok-4.6',
    active_job_id: 'AIJ-BUSYFIXTURE',
    active_job_action: 'review_specialist_work',
    providers: {},
    codex: { status: 'ready' },
  },
  service: { status: 'running' },
  models: { count: 1, models: [{ id: 'xai/grok-4.6' }] },
  jobs: { counts: { running: 1 } },
};
runtime.context.busyBridgeFixture = busyBridgeFixture;
vm.runInContext('state.intelligence.data = busyBridgeFixture; renderIntelligence();', runtime.context);
assert.equal(runtime.elements.get('intelligence-bridge-pill').textContent, 'Busy · lease active');
assert.match(runtime.elements.get('intelligence-bridge-detail').innerHTML, /AIJ-BUSYFIXTURE/);
assert.match(runtime.elements.get('intelligence-bridge-detail').innerHTML, /heartbeat lease is current/);

console.log('research case and detection learning runtime rendering checks passed');
