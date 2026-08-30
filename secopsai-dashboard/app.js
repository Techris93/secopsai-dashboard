window.__SECOPSAI_APP_LOADED = true;
window.__SECOPSAI_DEBUG = { htmlLoaded: true, configLoaded: Boolean(window.SECOPSAI_CONFIG), appLoaded: true };

function isExternalBrowserInjectionError(event) {
  const message = String(event?.message || '');
  const filename = String(event?.filename || '');
  return /cannot redefine property:\s*ethereum/i.test(message)
    && (!filename || /^(?:chrome|moz|safari)-extension:\/\//i.test(filename));
}

window.addEventListener('error', event => {
  if (isExternalBrowserInjectionError(event)) return;
  const status = document.getElementById('global-status');
  if (status) status.textContent = `JS error: ${event.message || 'unknown error'}`;
});

window.addEventListener('unhandledrejection', event => {
  const status = document.getElementById('global-status');
  const reason = event.reason && (event.reason.message || String(event.reason));
  const lowerReason = String(reason || '').toLowerCase();
  if (lowerReason.includes('metamask') || lowerReason.includes('wallet') || lowerReason.includes('ethereum')) return;
  // Browser crypto/auth helpers can reject while the Supabase session is being
  // restored. Do not expose an implementation detail such as "Key ring is
  // empty" as if it were a SecOpsAI platform failure. The auth surface and
  // API responses remain the source of truth for session state.
  if (lowerReason.includes('key ring') || lowerReason.includes('keyring')) {
    if (status) status.textContent = 'Authentication session needs refresh.';
    return;
  }
  if (status) status.textContent = `Promise error: ${reason || 'unknown rejection'}`;
});

const supabaseGlobal = window.supabase;
const cfg = window.SECOPSAI_CONFIG || {};
let supabaseClient = null;
let bootError = null;
let authSubscription = null;

if (!supabaseGlobal || typeof supabaseGlobal.createClient !== 'function') {
  bootError = 'Supabase client library failed to load.';
} else if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey) {
  bootError = 'SecOpsAI dashboard config is missing Supabase credentials.';
} else {
  supabaseClient = supabaseGlobal.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
}

function getRoleLabelsFromConfig(config) {
  try {
    const groups = config?.roleGroups || {};
    const flat = Object.values(groups).flat().filter(Boolean);
    // preserve order, unique
    const uniq = [];
    for (const r of flat) {
      if (!uniq.includes(r)) uniq.push(r);
    }
    // ensure orchestrator is present
    if (!uniq.includes('exec/agents-orchestrator')) uniq.unshift('exec/agents-orchestrator');
    return uniq;
  } catch {
    return [];
  }
}

const ROLE_LABELS = (() => {
  const fromCfg = getRoleLabelsFromConfig(cfg);
  if (fromCfg.length) return fromCfg;
  // fallback
  return [
    'exec/agents-orchestrator',
    'platform/software-architect',
    'platform/backend-architect',
    'platform/ai-engineer',
    'platform/devops-automator',
    'security/security-engineer',
    'security/threat-detection-engineer'
  ];
})();

const ROLE_OPTIONS_HTML = (() => {
  const opts = ROLE_LABELS.map(r => {
    const parts = r.split('/');
    const short = parts[parts.length - 1] || r;
    return `<option value="${escapeHtml(r)}">${escapeHtml(short)}</option>`;
  }).join('');
  return `<option value="">Unassigned</option>${opts}`;
})();

const TRIAGE_CAMPAIGN_ECOSYSTEMS = [
  ['npm', 'npm'],
  ['pypi', 'PyPI'],
  ['crates', 'crates.io'],
  ['chrome-web-store', 'Chrome Web Store'],
  ['packagist', 'Packagist'],
  ['go', 'Go Modules'],
  ['huggingface', 'Hugging Face Hub'],
  ['maven', 'Maven Central'],
  ['nuget', 'NuGet'],
  ['open-vsx', 'Open VSX'],
  ['rubygems', 'RubyGems']
];

function defaultCampaignForm() {
  return {
    campaign_id: '',
    title: '',
    summary: '',
    source_urls: [''],
    source_names: [''],
    actors: [''],
    publishers: [''],
    iocs: [''],
    behavioral_indicators: [''],
    search_root: '',
    packages: [
      {
        ecosystem: 'npm',
        package: '',
        version: '',
        publisher: '',
        behavior_notes: ''
      }
    ],
    jsonText: '',
    jsonError: ''
  };
}

const state = {
  auth: {
    session: null,
    user: null,
    activeUserId: null,
    recoveryMode: false
  },
  runs: [],
  runRequests: [],
  findings: [],
  workItems: [],
  channelRoutes: [],
  events: [],
  integrationStatus: null,
  intelligence: {
    data: null,
    loading: false,
    error: null,
    adminToken: sessionStorage.getItem('secopsai_intelligence_admin_token') || sessionStorage.getItem('secopsai_triage_ops_admin_token') || '',
    selectedModel: sessionStorage.getItem('secopsai_bridge_model') || '',
    pendingSelectedModel: '',
    view: 'models',
    fallbackModels: [],
    fallbackMode: 'disabled',
    modelSearch: '',
    routingDirty: false,
    selectedJobId: null,
    serviceOutput: ''
  },
  specialists: {
    data: null,
    loading: false,
    error: null,
    selectedRunId: null,
    policyDirty: false,
    policySaving: false
  },
  edgeWorkspace: {
    view: 'inventory',
    selectedAssetId: null,
    data: null,
    loading: false,
    error: null
  },
  coverage: {
    collectors: [],
    events: [],
    windows: [],
    loading: false,
    error: null
  },
  enterprise: {
    data: null,
    loading: false,
    error: null,
    activeTab: 'monitor',
    activeAssessment: 'vulnerability',
    eventFilter: 'all',
    outputs: {}
  },
  artifactFleet: {
    data: null,
    loading: false,
    error: null,
    output: '',
    researchOutput: '',
    researchError: null,
    researchResult: null,
    researchCommand: '',
    researchCompletedActions: [],
    researchFollowupResults: {}
  },
  researchCases: {
    view: 'cases',
    cases: [],
    selectedId: null,
    selected: null,
    loading: false,
    error: null,
    lastAction: null,
    resolution: { settings: {}, summary: {}, runs: [] },
    retractTarget: null,
    watchlist: {
      packages: [],
      loading: false,
      error: null,
      result: null
    },
    discovery: {
      capabilities: null,
      watchlists: [],
      monitors: [],
      candidates: [],
      alerts: [],
      campaigns: [],
      promotionPolicy: null,
      loading: false,
      error: null,
      lastAction: null
    },
    sandboxRecommendations: {
      recommendations: [],
      summary: null,
      provider: null,
      loading: false,
      error: null
    },
    adminToken: sessionStorage.getItem('secopsai_triage_ops_admin_token') || sessionStorage.getItem('secopsai_blog_ops_admin_token') || ''
  },
  localTriage: null,
  blogOps: {
    view: 'review',
    status: null,
    drafts: [],
    runs: [],
    selectedSlug: null,
    selectedDraft: null,
    loading: false,
    lastAction: null,
    adminToken: sessionStorage.getItem('secopsai_blog_ops_admin_token') || ''
  },
  integrationView: 'health',
  triageOps: {
    alerts: [],
    selectedId: null,
    selectedDetail: null,
    verdictNotes: {},
    lastOutput: null,
    campaignFixtures: [],
    campaignCandidates: [],
    campaignDiscovery: {
      since: '24h',
      source: 'all',
      limit: 10,
      min_score: 35,
      selectedCandidateId: '',
      watchlistValue: '',
      watchlistKind: 'package'
    },
    campaign: defaultCampaignForm(),
    campaignResult: null,
    campaignLastOutput: null,
    researchRecommendation: {
      data: null,
      dismissed: false,
      loading: false,
      error: null,
      stale: false
    },
    loading: false,
    adminToken: sessionStorage.getItem('secopsai_triage_ops_admin_token') || sessionStorage.getItem('secopsai_blog_ops_admin_token') || ''
  },
  selectedFindingId: null,
  nativeCloseDraft: null,
  selectedSessionId: null,
  selectedSessionDetail: null,
  nativeFindingOverrides: new Map(),
  outputEvidenceCache: new Map(),
  liveRefreshTimer: null,
  surfaceRefreshTimer: null,
  surfaceRefreshInFlight: false,
  lastSurfaceRefreshAt: 0,
  lastResearchSurfaceRefreshAt: 0,
  actionAutoRefresh: new Map(),
  researchPipelinePollTimer: null,
  nativeEventSource: null,
  nativeStreamStatus: 'disconnected',
  nativeStreamLastEventAt: null,
  optionalTables: {
    findings: true,
    run_requests: true
  }
};

const taskModalState = { editingId: null, sourceFinding: null };
const promptModalState = {
  item: null,
  role: null,
  brief: null,
  mode: 'smart-local',
  runRequestId: null,
  relatedRunId: null,
  pollTimer: null,
  specialistPollTimer: null,
  launchedFromTaskModal: false,
  specialistContract: null,
  specialistRun: null
};
const dragState = { taskId: null };
let workView = 'table';
const pages = ["mission-control", "tasks", "findings", "edge", "automation", "integrations", "enterprise", "triage-ops", "research-cases", "coverage", "blog-ops", "operator-guide"];
const PAGE_ROUTES = Object.freeze({
  "mission-control": "overview",
  "tasks": "work",
  "findings": "findings",
  "edge": "assets",
  "automation": "automation",
  "integrations": "system",
  "enterprise": "enterprise",
  "triage-ops": "findings/supply-chain",
  "research-cases": "research/cases",
  "coverage": "research/coverage",
  "blog-ops": "publications",
  "operator-guide": "help"
});
const RESEARCH_VIEW_ROUTES = Object.freeze({
  inbox: 'research/inbox',
  cases: 'research/cases',
  campaigns: 'research/campaigns',
  watchlists: 'research/watchlists',
  disclosure: 'research/disclosure',
  sandbox: 'research/sandbox',
  resolved: 'research/resolved'
});
const BLOG_VIEW_ROUTES = Object.freeze({
  research: 'publications/research',
  advisories: 'publications/advisories',
  news: 'publications/news',
  drafts: 'publications/drafts',
  review: 'publications/review',
  published: 'publications/published'
});
const SYSTEM_VIEW_ROUTES = Object.freeze({
  health: 'system/health',
  integrations: 'system/integrations',
  credentials: 'system/credentials',
  audit: 'system/audit'
});
const ASSET_VIEW_ROUTES = Object.freeze({
  inventory: 'assets/inventory',
  changes: 'assets/changes',
  sensors: 'assets/sensors',
  schedules: 'assets/schedules',
  wifi: 'assets/wifi'
});
const AUTOMATION_VIEW_ROUTES = Object.freeze({
  models: 'automation/models',
  review: 'automation/review',
  investigations: 'automation/investigations',
  research: 'automation/research',
  learning: 'automation/learning',
  jobs: 'automation/jobs'
});
const ROUTE_PAGES = Object.freeze({
  ...Object.fromEntries(Object.entries(PAGE_ROUTES).map(([page, route]) => [route, page])),
  ...Object.fromEntries(Object.entries(RESEARCH_VIEW_ROUTES).map(([, route]) => [route, 'research-cases'])),
  ...Object.fromEntries(Object.entries(BLOG_VIEW_ROUTES).map(([, route]) => [route, 'blog-ops'])),
  ...Object.fromEntries(Object.entries(SYSTEM_VIEW_ROUTES).map(([, route]) => [route, 'integrations'])),
  ...Object.fromEntries(Object.entries(ASSET_VIEW_ROUTES).map(([, route]) => [route, 'edge'])),
  ...Object.fromEntries(Object.entries(AUTOMATION_VIEW_ROUTES).map(([, route]) => [route, 'automation'])),
  'system/automation': 'automation'
});
const TOP_NAV_PAGE = Object.freeze({
  "mission-control": "mission-control",
  "tasks": "tasks",
  "findings": "findings",
  "edge": "edge",
  "automation": "automation",
  "integrations": "integrations",
  "enterprise": "enterprise",
  "triage-ops": "findings",
  "research-cases": "research-cases",
  "coverage": "research-cases",
  "blog-ops": "blog-ops",
  "operator-guide": null
});

function primaryPageFor(pageId) {
  return Object.prototype.hasOwnProperty.call(TOP_NAV_PAGE, pageId)
    ? TOP_NAV_PAGE[pageId]
    : pageId;
}
const PAGE_CONTEXT = {
  "mission-control": "Overview · operational priorities",
  "tasks": "Work · ownership, approvals, and runs",
  "findings": "Findings · security issues and triage",
  "edge": "Assets · inventory, sensors, and changes",
  "automation": "Automation · models, policies, and learning",
  "integrations": "System · health and integrations",
  "enterprise": "Enterprise · cloud, governance, and scale",
  "triage-ops": "Findings · supply-chain review",
  "research-cases": "Research · evidence and disclosure",
  "coverage": "Research · global registry surveillance",
  "blog-ops": "Publications · newsroom and delivery",
  "operator-guide": "Help · operator guidance"
};

const OPERATOR_GUIDANCE = Object.freeze({
  findings: {
    title: 'Review the highest-priority finding that still needs a decision.',
    detail: 'Separate detection priority, confidence, maliciousness, and local exposure before choosing an action.',
    automation: 'collect evidence, correlate work, and start guarded investigations',
    approval: 'decide maliciousness, business impact, closure, and escalation',
    action: 'Open decision queue',
    target: 'finding-queue-section'
  },
  'findings/supply-chain': {
    title: 'Start with evidence, then decide package risk and local impact separately.',
    detail: 'A suspicious package can be absent locally; no local usage does not make the package benign.',
    automation: 'check advisories, local usage, artifacts, and evidence bundles',
    approval: 'choose disposition, mitigation, escalation, and research handoff',
    action: 'Open supply-chain review',
    target: 'triage-review-section'
  },
  work: {
    title: 'Resolve blocked ownership before creating more work.',
    detail: 'Open the oldest blocked or review item, confirm the next owner, then route a specialist only when a bounded brief exists.',
    automation: 'recommend a reviewed specialist and create a guarded execution contract',
    approval: 'accept ownership, scope, write access, and independent review',
    action: 'Open work queue',
    target: 'work-table'
  },
  'research/inbox': {
    title: 'Promote only candidates with a real package, artifact, advisory, or source-backed subject.',
    detail: 'Candidate scores prioritize review; they are not maliciousness verdicts.',
    automation: 'rank leads, validate identifiers, and explain promotion eligibility',
    approval: 'decide whether the lead deserves a durable case',
    action: 'Review candidates',
    target: 'research-inbox-candidates'
  },
  'research/cases': {
    title: 'Resolve the selected case’s first evidence blocker.',
    detail: 'Move in order: evidence, matrix, specialist review, human verdict, publication safety.',
    automation: 'collect metadata, compare artifacts, build evidence, and queue bounded review',
    approval: 'record the verdict, disclosure decision, and publication readiness',
    action: 'Open case workflow',
    target: 'research-case-workspace-section'
  },
  'research/campaigns': {
    title: 'Confirm relationships without turning shared infrastructure into attribution.',
    detail: 'Packages, publishers, timelines, and infrastructure need independent supporting evidence.',
    automation: 'correlate deterministic relationships and surface contradictions',
    approval: 'decide campaign scope and attribution confidence',
    action: 'Review campaigns',
    target: 'research-campaigns-list'
  },
  'research/watchlists': {
    title: 'Run due monitors, then review each lead before promotion.',
    detail: 'A scoped watchlist is coverage for that subject, not proof the wider ecosystem is clean.',
    automation: 'monitor approved sources and rank explainable leads',
    approval: 'create cases, change watchlists, and accept campaign links',
    action: 'Review monitors',
    target: 'research-discovery-section'
  },
  'research/coverage': {
    title: 'Repair gaps and dead letters before trusting a quiet feed.',
    detail: 'A degraded or paused collector means surveillance is incomplete, not clean.',
    automation: 'track cursors, lag, coverage windows, and failed events',
    approval: 'pause sources, retry failures, and accept known coverage gaps',
    action: 'Inspect collectors',
    target: 'coverage-collectors-section'
  },
  'research/disclosure': {
    title: 'Review deadlines and prepare evidence-linked communication.',
    detail: 'Drafting and sending remain separate so unsupported claims cannot leave the workspace.',
    automation: 'prepare source-backed disclosure drafts and track deadlines',
    approval: 'choose recipient, wording, timing, and final send',
    action: 'Review disclosure queue',
    target: 'research-disclosure-queue'
  },
  'research/sandbox': {
    title: 'Submit only an exact, hash-verified artifact when static evidence justifies it.',
    detail: 'Public sandbox submissions may expose the sample; verify provider state and confidentiality first.',
    automation: 'recommend sandboxing, submit approved hashes, poll, and link sanitized results',
    approval: 'authorize public upload and accept the runtime interpretation',
    action: 'Review sandbox jobs',
    target: 'research-sandbox-queue'
  },
  'research/resolved': {
    title: 'Audit agent-resolved cases before accepting closure at scale.',
    detail: 'Only evidence-complete, reversible benign outcomes qualify for automatic resolution.',
    automation: 'apply guarded benign decisions and preserve a reversible audit record',
    approval: 'accept, reopen, or change the resolution policy',
    action: 'Review resolutions',
    target: 'research-resolved-section'
  },
  publications: {
    title: 'Choose the editorial queue that matches the evidence source.',
    detail: 'Original research, advisories, and external news have different review obligations.',
    automation: 'prepare drafts, validate structure, rebuild feeds, and retain workflow history',
    approval: 'approve claims, publish staged content, and deploy separately',
    action: 'Choose a queue',
    target: 'blog-queues-section'
  },
  'publications/published': {
    title: 'Confirm the last publish and deployment completed successfully.',
    detail: 'Publishing writes the archive; deployment makes it public and only then marks drafts Deployed.',
    automation: 'retain the post archive, rebuild feeds, and record deployment runs',
    approval: 'approve content and start the Cloudflare deployment',
    action: 'Review workflow runs',
    target: 'blog-published-section'
  },
  'automation/models': {
    title: 'Restore a healthy selected model before processing more queued work.',
    detail: 'The persisted primary and fallback policy are the effective route; provider recommendations are informational.',
    automation: 'probe the selected route and process durable bounded jobs',
    approval: 'choose the primary model, fallback scope, and service controls',
    action: 'Review model health',
    target: 'automation-bridge-section'
  },
  'automation/review': {
    title: 'Review new alerts under the saved guarded policy.',
    detail: 'Model proposals remain advisory until deterministic evidence supports a reversible action.',
    automation: 'triage normalized alerts and propose bounded tuning',
    approval: 'apply dispositions and promote validated tuning',
    action: 'Open alert review',
    target: 'automation-alert-review-section'
  },
  'automation/investigations': {
    title: 'Recover failed investigations before starting duplicate cycles.',
    detail: 'Check active and failed runs, then run only work that is due.',
    automation: 'collect evidence, run static checks, queue model review, and retry safe stages',
    approval: 'authorize protected actions and accept final decisions',
    action: 'Review investigations',
    target: 'automation-investigations-section'
  },
  'automation/research': {
    title: 'Preview exact metadata before collecting or analyzing an artifact.',
    detail: 'The universal pipeline never installs, activates, or executes package code.',
    automation: 'quarantine, hash, scan, compare, and build a reviewable case',
    approval: 'persist findings, accept model review, and create a publication draft',
    action: 'Open safe research',
    target: 'automation-research-section'
  },
  'automation/learning': {
    title: 'Promote learning only when replay proves it will not increase false negatives.',
    detail: 'Insufficient data and shadow results must remain visibly non-production.',
    automation: 'retain feedback, replay proposals, and measure holdout performance',
    approval: 'promote, canary, activate, or roll back a rule change',
    action: 'Review learning',
    target: 'automation-learning-section'
  },
  'automation/jobs': {
    title: 'Recover the oldest blocked pipeline before adding new model jobs.',
    detail: 'Jobs are grouped by case so the current stage, model, age, and recovery action stay together.',
    automation: 'persist, retry, and group bounded analysis stages',
    approval: 'cancel, requeue, or accept the resulting analysis',
    action: 'Review job pipelines',
    target: 'automation-jobs-section'
  },
  'system/health': {
    title: 'Resolve degraded dependencies before relying on their data.',
    detail: 'Blank or stale status is unknown coverage, not a healthy result.',
    automation: 'poll Core, Edge, helper, database, event stream, and queue health',
    approval: 'restart services or change runtime configuration',
    action: 'Review health',
    target: 'integration-summary'
  },
  'system/integrations': {
    title: 'Confirm the helper APIs and event stream are ready.',
    detail: 'Capability, configuration, and recent activity are separate states.',
    automation: 'report route readiness and recent source-of-truth evidence',
    approval: 'connect, rotate, or reconfigure integrations',
    action: 'Review integrations',
    target: 'integration-config'
  },
  'system/credentials': {
    title: 'Resolve missing credential readiness without exposing secret values.',
    detail: 'This page reports status only; credentials belong in the owning server or session-scoped action field.',
    automation: 'report whether each protected workflow is ready',
    approval: 'enter, rotate, or revoke credentials',
    action: 'Review readiness',
    target: 'system-credentials'
  },
  'system/audit': {
    title: 'Review pending actions and incomplete sessions before applying anything.',
    detail: 'Every mutation must have evidence, an owner, and an auditable recovery path.',
    automation: 'record actions, sessions, approvals, and orchestrator history',
    approval: 'apply queued actions and resolve investigation approvals',
    action: 'Review audit queue',
    target: 'system-action-queue-section'
  },
  enterprise: {
    title: 'Connect one approved read-only source before expanding governance workflows.',
    detail: 'Implemented, configured, and actively sending evidence are deliberately separate states.',
    automation: 'normalize telemetry, prioritize exposures, and preserve control evidence',
    approval: 'connect sources, authorize DAST, and create governance records',
    action: 'Review setup steps',
    target: 'enterprise-next-actions'
  },
  assets: {
    title: 'Inspect the newest asset change or degraded sensor first.',
    detail: 'Inventory observations provide context; they do not independently prove compromise.',
    automation: 'collect inventory, service, sensor, schedule, and change evidence',
    approval: 'accept asset ownership and remediation work',
    action: 'Review inventory',
    target: 'edge-inventory-section'
  }
});
const CONTEXT_NAV = Object.freeze({
  "mission-control": [],
  "findings": [
    ["All findings", "findings", PAGE_ROUTES.findings],
    ["Supply chain", "triage-ops", PAGE_ROUTES['triage-ops']]
  ],
  "edge": [
    ["Inventory", "edge", ASSET_VIEW_ROUTES.inventory],
    ["Changes", "edge", ASSET_VIEW_ROUTES.changes],
    ["Sensors", "edge", ASSET_VIEW_ROUTES.sensors],
    ["Scans & schedules", "edge", ASSET_VIEW_ROUTES.schedules],
    ["Wi-Fi", "edge", ASSET_VIEW_ROUTES.wifi]
  ],
  "tasks": [],
  "research-cases": [
    ["Inbox", "research-cases", RESEARCH_VIEW_ROUTES.inbox],
    ["Cases", "research-cases", RESEARCH_VIEW_ROUTES.cases],
    ["Campaigns", "research-cases", RESEARCH_VIEW_ROUTES.campaigns],
    ["Watchlists", "research-cases", RESEARCH_VIEW_ROUTES.watchlists],
    ["Global coverage", "coverage", PAGE_ROUTES.coverage],
    ["Disclosure", "research-cases", RESEARCH_VIEW_ROUTES.disclosure],
    ["Sandbox jobs", "research-cases", RESEARCH_VIEW_ROUTES.sandbox],
    ["Resolved by agents", "research-cases", RESEARCH_VIEW_ROUTES.resolved]
  ],
  "coverage": [
    ["Coverage", "coverage", PAGE_ROUTES.coverage],
    ["Candidates", "research-cases", RESEARCH_VIEW_ROUTES.inbox],
    ["Cases", "research-cases", RESEARCH_VIEW_ROUTES.cases]
  ],
  "blog-ops": [
    ["Original research", "blog-ops", BLOG_VIEW_ROUTES.research],
    ["Advisories", "blog-ops", BLOG_VIEW_ROUTES.advisories],
    ["News intake", "blog-ops", BLOG_VIEW_ROUTES.news],
    ["Drafts", "blog-ops", BLOG_VIEW_ROUTES.drafts],
    ["Review", "blog-ops", BLOG_VIEW_ROUTES.review],
    ["Published", "blog-ops", BLOG_VIEW_ROUTES.published]
  ],
  "integrations": [
    ["Health", "integrations", SYSTEM_VIEW_ROUTES.health],
    ["Integrations", "integrations", SYSTEM_VIEW_ROUTES.integrations],
    ["Credentials", "integrations", SYSTEM_VIEW_ROUTES.credentials],
    ["Audit log", "integrations", SYSTEM_VIEW_ROUTES.audit]
  ],
  "enterprise": [],
  "automation": [
    ["Models", "automation", AUTOMATION_VIEW_ROUTES.models],
    ["Alert review", "automation", AUTOMATION_VIEW_ROUTES.review],
    ["Investigations", "automation", AUTOMATION_VIEW_ROUTES.investigations],
    ["Research pipeline", "automation", AUTOMATION_VIEW_ROUTES.research],
    ["Learning", "automation", AUTOMATION_VIEW_ROUTES.learning],
    ["Jobs", "automation", AUTOMATION_VIEW_ROUTES.jobs]
  ],
  "triage-ops": [
    ["All findings", "findings", PAGE_ROUTES.findings],
    ["Supply chain", "triage-ops", PAGE_ROUTES['triage-ops']]
  ],
  "operator-guide": []
});

// Secondary navigation must make the destination visible immediately. These
// targets are deliberately tied to rendered panel IDs, not hidden routes.
const CONTEXT_SCROLL_TARGETS = Object.freeze({
  'findings/supply-chain': 'page-triage-ops',
  'assets/inventory': 'edge-assets',
  'assets/changes': 'edge-change-timeline',
  'assets/sensors': 'edge-sensors',
  'assets/schedules': 'edge-schedules',
  'assets/wifi': 'edge-wifi',
  'automation/models': 'automation-models-tab',
  'automation/review': 'automation-alert-review-section',
  'automation/investigations': 'automation-investigations-section',
  'automation/research': 'automation-research-section',
  'automation/learning': 'automation-learning-section',
  'automation/jobs': 'automation-jobs-section',
  'research/inbox': 'research-inbox-title',
  'research/cases': 'research-case-list',
  'research/campaigns': 'research-campaigns-title',
  'research/watchlists': 'research-discovery-title',
  'research/disclosure': 'research-disclosure-title',
  'research/sandbox': 'research-sandbox-title',
  'research/resolved': 'research-resolution-title',
  'research/coverage': 'page-coverage',
  'publications/research': 'blog-draft-list',
  'publications/advisories': 'blog-draft-list',
  'publications/news': 'blog-draft-list',
  'publications/drafts': 'blog-draft-list',
  'publications/review': 'blog-draft-list',
  'publications/published': 'blog-workflow-runs',
  'system/health': 'integration-summary',
  'system/integrations': 'integration-config',
  'system/credentials': 'system-credentials',
  'system/audit': 'native-session-detail'
});

// In-page navigation is intentionally separate from route navigation. Route
// tabs change the data view; these nested items move directly to the visible
// work surface inside that view. Keeping the map explicit prevents a large
// page from becoming a guessing exercise for operators and gives every target
// a stable, testable anchor.
const PAGE_SUBSECTION_DEFS = Object.freeze({
  'mission-control': [
    ['Needs attention', 'mission-attention'],
    ['Summary', 'mission-stats'],
    ['Operational view', 'mission-overview'],
    ['Research queues', 'mission-queues-section']
  ],
  tasks: [
    ['Filters', 'work-filters'],
    ['Table', 'work-table'],
    ['Board', 'task-board']
  ],
  findings: [
    ['Filters', 'finding-filters'],
    ['Summary', 'finding-summary'],
    ['Findings queue', 'finding-queue-section']
  ],
  edge: [
    ['Health', 'edge-health'],
    ['Sensors', 'edge-sensors-section'],
    ['Scans and schedules', 'edge-schedules-section'],
    ['Inventory', 'edge-inventory-section'],
    ['Asset detail', 'edge-asset-detail-section'],
    ['Related findings', 'edge-related-section'],
    ['Changes', 'edge-change-timeline-section'],
    ['Wi-Fi', 'edge-wifi-section']
  ],
  automation: [],
  integrations: [
    ['Health', 'integration-summary'],
    ['Integrations', 'integration-config'],
    ['Credentials', 'system-credentials'],
    ['Action queue', 'system-action-queue-section'],
    ['Sessions', 'system-sessions-section'],
    ['Session detail', 'system-session-detail-section'],
    ['Orchestrator runs', 'system-runs-section']
  ],
  automation: [
    ['Models', AUTOMATION_VIEW_ROUTES.models],
    ['Alert review', AUTOMATION_VIEW_ROUTES.review],
    ['Investigations', AUTOMATION_VIEW_ROUTES.investigations],
    ['Research pipeline', AUTOMATION_VIEW_ROUTES.research],
    ['Learning', AUTOMATION_VIEW_ROUTES.learning],
    ['Jobs', AUTOMATION_VIEW_ROUTES.jobs]
  ],
  'triage-ops': [
    ['Access', 'triage-access-section'],
    ['Alert review', 'triage-review-section'],
    ['Campaign research', 'triage-campaign-section']
  ],
  coverage: [
    ['Pipeline actions', 'coverage-actions-section'],
    ['Collectors', 'coverage-collectors-section'],
    ['Feed events', 'coverage-events-section'],
    ['Coverage windows', 'coverage-windows-section']
  ],
  'blog-ops': [
    ['Access', 'blog-access-section'],
    ['Actions', 'blog-actions-section'],
    ['Editorial queues', 'blog-queues-section'],
    ['Draft review', 'blog-drafts-section'],
    ['Published runs', 'blog-published-section']
  ],
  'operator-guide': [
    ['Safe automations', 'guide-automations'],
    ['Access and recovery', 'guide-access'],
    ['Overview', 'guide-overview'],
    ['Work', 'guide-tasks'],
    ['Findings', 'guide-findings'],
    ['Research', 'guide-research'],
    ['Detection guard', 'guide-ai-dependency-guard'],
    ['Native triage', 'guide-native-triage'],
    ['Supply chain', 'guide-triage-ops'],
    ['Campaigns', 'guide-campaigns'],
    ['Discovery', 'guide-discovery'],
    ['Publications', 'guide-blog-ops'],
    ['Safety rules', 'guide-safe-actions']
  ]
});

// These were previously rendered in the top strip as a second row of tabs.
// Keep the route definitions here so each primary section owns its views in
// one place: Findings owns Supply Chain, Research owns Coverage and Cases,
// System owns Health/Integrations/Credentials/Audit, and so on.
const PAGE_ROUTE_SUBSECTION_DEFS = Object.freeze({
  findings: [
    ['All findings', PAGE_ROUTES.findings],
    ['Supply chain', PAGE_ROUTES['triage-ops']]
  ],
  edge: [
    ['Inventory', ASSET_VIEW_ROUTES.inventory],
    ['Changes', ASSET_VIEW_ROUTES.changes],
    ['Sensors', ASSET_VIEW_ROUTES.sensors],
    ['Scans and schedules', ASSET_VIEW_ROUTES.schedules],
    ['Wi-Fi', ASSET_VIEW_ROUTES.wifi]
  ],
  'research-cases': [
    ['Inbox', RESEARCH_VIEW_ROUTES.inbox],
    ['Cases', RESEARCH_VIEW_ROUTES.cases],
    ['Campaigns', RESEARCH_VIEW_ROUTES.campaigns],
    ['Watchlists', RESEARCH_VIEW_ROUTES.watchlists],
    ['Global coverage', PAGE_ROUTES.coverage],
    ['Disclosure', RESEARCH_VIEW_ROUTES.disclosure],
    ['Sandbox jobs', RESEARCH_VIEW_ROUTES.sandbox],
    ['Resolved by agents', RESEARCH_VIEW_ROUTES.resolved]
  ],
  coverage: [
    ['Coverage', PAGE_ROUTES.coverage],
    ['Candidates', RESEARCH_VIEW_ROUTES.inbox],
    ['Cases', RESEARCH_VIEW_ROUTES.cases]
  ],
  'blog-ops': [
    ['Original research', BLOG_VIEW_ROUTES.research],
    ['Advisories', BLOG_VIEW_ROUTES.advisories],
    ['News intake', BLOG_VIEW_ROUTES.news],
    ['Drafts', BLOG_VIEW_ROUTES.drafts],
    ['Review', BLOG_VIEW_ROUTES.review],
    ['Published', BLOG_VIEW_ROUTES.published]
  ],
  integrations: [
    ['Health', SYSTEM_VIEW_ROUTES.health],
    ['Integrations', SYSTEM_VIEW_ROUTES.integrations],
    ['Credentials', SYSTEM_VIEW_ROUTES.credentials],
    ['Audit log', SYSTEM_VIEW_ROUTES.audit]
  ],
  automation: [
    ['Models', AUTOMATION_VIEW_ROUTES.models],
    ['Alert review', AUTOMATION_VIEW_ROUTES.review],
    ['Investigations', AUTOMATION_VIEW_ROUTES.investigations],
    ['Research pipeline', AUTOMATION_VIEW_ROUTES.research],
    ['Learning', AUTOMATION_VIEW_ROUTES.learning],
    ['Jobs', AUTOMATION_VIEW_ROUTES.jobs]
  ],
  'triage-ops': [
    ['All findings', PAGE_ROUTES.findings],
    ['Supply chain', PAGE_ROUTES['triage-ops']]
  ]
});

let subsectionObserver = null;
let collapsedSidebarPrimaryPage = null;

function elementIsVisible(element) {
  if (!element) return false;
  let current = element;
  while (current && current !== document.body) {
    if (current.hidden || current.classList?.contains('hidden') || current.getAttribute('aria-hidden') === 'true') return false;
    current = current.parentElement;
  }
  return true;
}

function setActiveSubsectionButton(buttons, targetId, route = '') {
  buttons.forEach(button => {
    const active = route
      ? button.dataset.subsectionRoute === route
      : button.dataset.subsectionTarget === targetId;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'location');
    else button.removeAttribute('aria-current');
  });
}

function renderSidebarSubnav(pageId, routeOverride = null) {
  const nav = el('dashboard-nav');
  if (!nav) return;
  nav.querySelector('#sidebar-subnav')?.remove();
  if (subsectionObserver) {
    subsectionObserver.disconnect();
    subsectionObserver = null;
  }
  nav.querySelectorAll('.nav-btn').forEach(button => {
    button.removeAttribute('aria-expanded');
    button.removeAttribute('aria-controls');
  });
  const activeTopPage = primaryPageFor(pageId);
  if (!activeTopPage) return;

  const currentRoute = String(routeOverride || window.location.hash || routeForPage(pageId) || '')
    .replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase();
  const routeEntries = (PAGE_ROUTE_SUBSECTION_DEFS[pageId] || [])
    .map(([label, route]) => ({ label, route, kind: 'route' }));
  const panelEntries = (PAGE_SUBSECTION_DEFS[pageId] || [])
    .map(([label, target]) => ({ label, target: el(target), kind: 'panel' }))
    .filter(item => elementIsVisible(item.target));
  const entries = [...routeEntries, ...panelEntries];
  if (entries.length < 2) return;

  const activePrimary = nav.querySelector(`.nav-btn[data-page="${CSS.escape(activeTopPage)}"]`)
    || nav.querySelector('.nav-btn.active');

  const host = document.createElement('div');
  host.id = 'sidebar-subnav';
  host.className = 'sidebar-subnav';
  host.setAttribute('aria-label', `${PAGE_CONTEXT[pageId] || pageId} subsections`);
  host.hidden = collapsedSidebarPrimaryPage === activeTopPage;
  const renderRouteButton = ({ label, route }) => `
    <button class="sidebar-subnav-btn sidebar-subnav-route" type="button" data-subsection-route="${escapeHtml(route)}"${route === currentRoute ? ' aria-current="location"' : ''}>
      <span class="sidebar-subnav-marker" aria-hidden="true"></span><span>${escapeHtml(label)}</span>
    </button>`;
  const renderPanelButton = ({ label, target }) => `
    <button class="sidebar-subnav-btn" type="button" data-subsection-target="${escapeHtml(target.id)}">
      <span class="sidebar-subnav-marker" aria-hidden="true"></span><span>${escapeHtml(label)}</span>
    </button>`;
  host.innerHTML = [
    routeEntries.length ? `<div class="sidebar-subnav-heading">Views</div>${routeEntries.map(renderRouteButton).join('')}` : '',
    panelEntries.length ? `<div class="sidebar-subnav-heading">In this view</div>${panelEntries.map(renderPanelButton).join('')}` : ''
  ].join('');

  activePrimary?.setAttribute('aria-expanded', String(!host.hidden));
  activePrimary?.setAttribute('aria-controls', 'sidebar-subnav');
  if (activePrimary) activePrimary.insertAdjacentElement('afterend', host);
  else nav.prepend(host);

  if (host.hidden) return;

  const buttons = [...host.querySelectorAll('[data-subsection-target], [data-subsection-route]')];
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      const route = button.dataset.subsectionRoute || '';
      if (route) {
        setActiveSubsectionButton(buttons, '', route);
        setPage(pageIdForRoute(route), { routeOverride: route });
        return;
      }
      const target = el(button.dataset.subsectionTarget);
      if (!elementIsVisible(target)) return;
      setActiveSubsectionButton(buttons, target.id);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (window.innerWidth <= 720) {
        document.body.classList.remove('mobile-nav-open');
        el('mobile-menu-btn')?.setAttribute('aria-expanded', 'false');
      }
    });
  });

  const observedTargets = panelEntries.map(({ target }) => target).filter(Boolean);
  if ('IntersectionObserver' in window && observedTargets.length) {
    subsectionObserver = new IntersectionObserver(intersections => {
      const visible = intersections
        .filter(item => item.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActiveSubsectionButton(buttons, visible.target.id);
    }, { rootMargin: '-112px 0px -62% 0px', threshold: [0, 0.2, 0.6] });
    observedTargets.forEach(target => subsectionObserver.observe(target));
  }
}

function togglePrimarySectionNavigation(button) {
  const requestedPage = button?.dataset.page || 'mission-control';
  const currentPage = currentPageFromLocation();
  const requestedPrimaryPage = primaryPageFor(requestedPage);
  const currentPrimaryPage = primaryPageFor(currentPage);
  const isCurrentPrimary = button?.classList.contains('active') && requestedPrimaryPage === currentPrimaryPage;

  if (isCurrentPrimary) {
    collapsedSidebarPrimaryPage = collapsedSidebarPrimaryPage === currentPrimaryPage
      ? null
      : currentPrimaryPage;
    renderSidebarSubnav(currentPage, routeForPage(currentPage));
    return;
  }

  collapsedSidebarPrimaryPage = null;
  setPage(requestedPage, { routeOverride: button?.dataset.route || null, scrollToTarget: false });
}

function collapseSidebarForInitialRoute(pageId = currentPageFromLocation()) {
  collapsedSidebarPrimaryPage = primaryPageFor(pageId);
}

function scrollToContextTarget(route) {
  const normalized = String(route || '').replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase();
  const targetId = CONTEXT_SCROLL_TARGETS[normalized];
  if (!targetId) return;
  window.requestAnimationFrame(() => {
    const target = el(targetId);
    if (target && !target.hidden) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function scrollPrimaryPageToTop() {
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const main = document.querySelector('.main');
    if (main) main.scrollTop = 0;
  });
}
const COMMANDS = Object.freeze([
  ["Open Overview", "See priorities, changes, and system health", "mission-control"],
  ["Review Findings", "Triage canonical security issues", "findings"],
  ["Review Supply Chain", "Inspect package and dependency alerts", "triage-ops"],
  ["Open Assets", "Inspect network inventory and Edge sensors", "edge"],
  ["Open Work", "Manage tasks, approvals, and runs", "tasks"],
  ["Open Research", "Investigate leads and research cases", "research-cases"],
  ["Open Global Coverage", "Inspect registry collectors, cursor lag, and surveillance health", "coverage"],
  ["Open Publications", "Review and deliver public content", "blog-ops"],
  ["Open Automation", "Configure models, policies, and learning", "automation"],
  ["Open System", "Check health, integrations, and audit context", "integrations"],
  ["Open Help", "Read contextual operator guidance", "operator-guide"]
]);

function el(id) { return document.getElementById(id); }

function dashboardAuthRequired() {
  return cfg?.auth?.required !== false;
}

async function dashboardApiFetch(input, init = {}) {
  const headers = new Headers(init.headers || {});
  if (dashboardAuthRequired()) {
    const accessToken = state.auth.session?.access_token || '';
    if (!accessToken) throw new Error('Operator session required');
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  const response = await window.fetch(input, { ...init, headers });
  if (response.status === 401 && dashboardAuthRequired()) {
    const authFailure = await response.clone().json().catch(() => ({}));
    if (['operator_session_required', 'operator_session_invalid'].includes(String(authFailure?.code || ''))) {
      leaveAuthenticatedDashboard('Your operator session expired. Sign in again to continue.');
    }
  }
  return response;
}

function setAuthMessage(message, { error = false, update = false } = {}) {
  const target = el(update ? 'auth-update-message' : 'auth-message');
  if (!target) return;
  target.textContent = message;
  target.classList.toggle('error', error);
}

function setAuthBusy(button, busy, busyLabel) {
  if (!button) return;
  if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent || '';
  button.disabled = busy;
  button.textContent = busy ? busyLabel : button.dataset.idleLabel;
}

function showAuthSurface({ recovery = false, locked = false, message = '', error = false } = {}) {
  const gate = el('auth-gate');
  const shell = el('app-shell');
  const loginForm = el('auth-login-form');
  const updateForm = el('auth-update-form');
  const lockedMessage = el('auth-locked-message');
  const title = el('auth-title');
  const summary = el('auth-summary');
  const boundary = el('auth-boundary');
  gate?.classList.remove('hidden');
  shell?.classList.add('auth-pending');
  shell?.setAttribute('aria-hidden', 'true');
  loginForm?.classList.toggle('hidden', recovery || locked);
  updateForm?.classList.toggle('hidden', !recovery || locked);
  if (lockedMessage) lockedMessage.hidden = !locked;
  if (title) title.textContent = locked ? 'Operator access is not activated' : (recovery ? 'Reset operator password' : 'Operator sign in');
  if (summary) {
    summary.textContent = locked
      ? 'This deployment is locked until its database policies and invited operator account are verified.'
      : (recovery ? 'Choose a new password to recover your invited operator account.' : 'Authenticate before accessing findings, assets, research cases, or response workflows.');
  }
  if (boundary) {
    boundary.textContent = locked
      ? 'No live workspace records are loaded while operator authentication is disabled.'
      : 'Access is invitation-only. Sensor and integration credentials cannot sign in to this console.';
  }
  state.auth.recoveryMode = recovery;
  if (message) setAuthMessage(message, { error, update: recovery });
  if (!locked) window.setTimeout(() => el(recovery ? 'auth-new-password' : 'auth-email')?.focus(), 0);
}

function showAuthenticatedShell(session) {
  const gate = el('auth-gate');
  const shell = el('app-shell');
  const identity = el('operator-identity');
  const signOut = el('auth-signout-btn');
  gate?.classList.add('hidden');
  shell?.classList.remove('auth-pending');
  shell?.setAttribute('aria-hidden', 'false');
  const email = session?.user?.email || '';
  if (identity) {
    identity.textContent = email;
    identity.hidden = !email;
  }
  if (signOut) signOut.hidden = !session;
}

function stopDashboardRuntime() {
  if (state.liveRefreshTimer) {
    clearInterval(state.liveRefreshTimer);
    state.liveRefreshTimer = null;
  }
  if (state.surfaceRefreshTimer) {
    clearInterval(state.surfaceRefreshTimer);
    state.surfaceRefreshTimer = null;
  }
  if (state.researchPipelinePollTimer) {
    clearTimeout(state.researchPipelinePollTimer);
    state.researchPipelinePollTimer = null;
  }
  state.actionAutoRefresh.forEach(entry => {
    if (entry?.timer) clearTimeout(entry.timer);
  });
  state.actionAutoRefresh.clear();
  if (state.nativeEventSource) {
    state.nativeEventSource.close();
    state.nativeEventSource = null;
  }
}

async function enterAuthenticatedDashboard(session) {
  const userId = session?.user?.id || (dashboardAuthRequired() ? null : 'local-auth-disabled');
  if (dashboardAuthRequired() && !userId) {
    showAuthSurface({ message: 'Sign in with an invited operator account.' });
    return;
  }
  state.auth.session = session || null;
  state.auth.user = session?.user || null;
  if (state.auth.activeUserId === userId) {
    showAuthenticatedShell(session);
    return;
  }
  state.auth.activeUserId = userId;
  showAuthenticatedShell(session);
  const initialPage = currentPageFromLocation();
  collapseSidebarForInitialRoute(initialPage);
  setPage(initialPage, { skipHistory: true, scrollToTarget: false });
  setStatus('<span class="dot"></span> Loading authorized workspace…');
  await boot();
}

function leaveAuthenticatedDashboard(message = 'Your session ended. Sign in again to continue.') {
  stopDashboardRuntime();
  state.auth.session = null;
  state.auth.user = null;
  state.auth.activeUserId = null;
  showAuthSurface({ message });
}

async function initializeDashboardAuth() {
  if (!dashboardAuthRequired()) {
    showAuthSurface({
      locked: true,
      message: 'Operator authentication must be enabled before this console can load live data.',
      error: true
    });
    return;
  }

  if (bootError || !supabaseClient) {
    showAuthSurface({ message: bootError || 'Dashboard authentication is unavailable.', error: true });
    return;
  }

  const authListener = supabaseClient.auth.onAuthStateChange((event, session) => {
    window.setTimeout(async () => {
      if (event === 'PASSWORD_RECOVERY') {
        state.auth.session = session || null;
        state.auth.user = session?.user || null;
        showAuthSurface({ recovery: true, message: 'Choose a new password for this operator account.' });
        return;
      }
      if (session && !state.auth.recoveryMode) {
        await enterAuthenticatedDashboard(session);
      } else if (event === 'SIGNED_OUT') {
        leaveAuthenticatedDashboard();
      }
    }, 0);
  });
  authSubscription = authListener?.data?.subscription || null;

  const { data, error } = await supabaseClient.auth.getSession();
  await new Promise(resolve => window.setTimeout(resolve, 0));
  if (error) {
    showAuthSurface({ message: 'Unable to validate the browser session. Check the connection and retry.', error: true });
  } else if (data?.session && !state.auth.recoveryMode) {
    await enterAuthenticatedDashboard(data.session);
  } else if (!state.auth.recoveryMode) {
    showAuthSurface({ message: 'Sign in with an invited operator account.' });
  }
}

async function signInOperator(event) {
  event.preventDefault();
  const email = el('auth-email')?.value?.trim() || '';
  const password = el('auth-password')?.value || '';
  const button = el('auth-signin-btn');
  if (!email || !password) {
    setAuthMessage('Enter your operator email and password.', { error: true });
    return;
  }
  setAuthBusy(button, true, 'Signing in…');
  setAuthMessage('Validating operator access…');
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error || !data?.session) throw error || new Error('No session returned');
    if (el('auth-password')) el('auth-password').value = '';
    await enterAuthenticatedDashboard(data.session);
  } catch {
    setAuthMessage('Sign-in failed. Check your credentials or reset the password.', { error: true });
  } finally {
    setAuthBusy(button, false, 'Signing in…');
  }
}

async function requestPasswordReset() {
  const email = el('auth-email')?.value?.trim() || '';
  const button = el('auth-reset-request-btn');
  if (!email) {
    setAuthMessage('Enter your operator email before requesting a reset.', { error: true });
    el('auth-email')?.focus();
    return;
  }
  setAuthBusy(button, true, 'Requesting…');
  try {
    await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${window.location.pathname}`
    });
    setAuthMessage('If the account exists, a password reset link has been sent.');
  } catch {
    setAuthMessage('The reset request could not be completed. Check the connection and retry.', { error: true });
  } finally {
    setAuthBusy(button, false, 'Requesting…');
  }
}

async function updateRecoveredPassword(event) {
  event.preventDefault();
  const password = el('auth-new-password')?.value || '';
  const confirmation = el('auth-confirm-password')?.value || '';
  const button = el('auth-update-password-btn');
  if (password.length < 12) {
    setAuthMessage('Use at least 12 characters.', { error: true, update: true });
    return;
  }
  if (password !== confirmation) {
    setAuthMessage('The password confirmation does not match.', { error: true, update: true });
    return;
  }
  setAuthBusy(button, true, 'Updating…');
  try {
    const { data, error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;
    setAuthMessage('Password updated. Loading Mission Control…', { update: true });
    state.auth.recoveryMode = false;
    await enterAuthenticatedDashboard(state.auth.session || { user: data?.user });
  } catch {
    setAuthMessage('The password could not be updated. Request a new reset link and retry.', { error: true, update: true });
  } finally {
    setAuthBusy(button, false, 'Updating…');
  }
}

async function signOutOperator() {
  const button = el('auth-signout-btn');
  setAuthBusy(button, true, 'Signing out…');
  try {
    await supabaseClient.auth.signOut();
  } finally {
    setAuthBusy(button, false, 'Signing out…');
    leaveAuthenticatedDashboard('Signed out safely.');
  }
}

const DEFAULT_LATEST_FIRST_FIELDS = [
  'last_seen',
  'last_seen_at',
  'updated_at',
  'detected_at',
  'observed_at',
  'created_at',
  'first_seen',
  'first_seen_at',
  'published_at',
  'fetched_at',
  'generated_at',
  'completed_at',
  'started_at',
  'queued_at'
];
const FINDING_LATEST_FIELDS = ['last_seen', 'last_seen_at', 'updated_at', 'detected_at', 'observed_at', 'created_at', 'first_seen', 'first_seen_at'];
const BLOG_DRAFT_LATEST_FIELDS = ['source_metadata.published_at', 'published_at', 'updated_at', 'created_at', 'source_metadata.fetched_at', 'fetched_at'];
const BLOG_RUN_LATEST_FIELDS = ['updated_at', 'created_at', 'completed_at', 'started_at', 'run_started_at'];
const CAMPAIGN_CANDIDATE_LATEST_FIELDS = ['discovered_at', 'generated_at', 'updated_at', 'created_at', 'campaign.source_metadata.published_at', 'campaign.published_at', 'campaign.source_metadata.fetched_at'];

function valueAtPath(item, dottedPath) {
  return String(dottedPath || '').split('.').reduce((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[key];
  }, item);
}

function timestampFromValue(value) {
  if (value === null || typeof value === 'undefined' || typeof value === 'boolean') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 100000000000 ? value : value * 1000;
  }
  const text = String(value).trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const raw = Number(text);
    return raw > 100000000000 ? raw : raw * 1000;
  }
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (dmy) {
    const [, day, month, year, hour, minute, second = '0'] = dmy;
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function latestFirstTime(item, fields = DEFAULT_LATEST_FIRST_FIELDS) {
  for (const field of fields) {
    const timestamp = timestampFromValue(valueAtPath(item, field));
    if (timestamp > 0) return timestamp;
  }
  return 0;
}

function latestFirstDateValue(item, fields = DEFAULT_LATEST_FIRST_FIELDS) {
  for (const field of fields) {
    const value = valueAtPath(item, field);
    if (timestampFromValue(value) > 0) return value;
  }
  return null;
}

function sortLatestFirst(items, fields = DEFAULT_LATEST_FIRST_FIELDS) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => ({ item, index, timestamp: latestFirstTime(item, fields) }))
    .sort((a, b) => (b.timestamp - a.timestamp) || (a.index - b.index))
    .map(entry => entry.item);
}

function aiGuardConfig() {
  return cfg.aiGuard || {};
}

function aiGuardStatusLabel() {
  return aiGuardConfig().hostedEnabled ? 'Guarded enabled' : 'Local-first only';
}

function getRunOutputEndpointUrl(relPath) {
  const url = new URL(cfg.runOutputEndpoint || "/api/run-output", window.location.origin);
  if (relPath) url.searchParams.set("path", relPath);
  return url.toString();
}

function getRunOutputViewerUrl(relPath, { role = "", id = "" } = {}) {
  const url = new URL("/view-run-output.html", window.location.origin);
  if (relPath) url.searchParams.set("path", relPath);
  if (role) url.searchParams.set("role", role);
  if (id) url.searchParams.set("id", id);
  return url.toString();
}

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleString();
}

function localTriageSummary() {
  return state.localTriage?.summary || null;
}

function localSessionSummary() {
  return state.localTriage?.sessions || null;
}

function recentLocalSessions() {
  return Array.isArray(localSessionSummary()?.recent) ? localSessionSummary().recent : [];
}

function openLocalSessionsCount() {
  return Number(localSessionSummary()?.open_count || 0);
}

function pendingLocalApprovalsCount() {
  return Number(localSessionSummary()?.pending_approvals || 0);
}

function sessionsForFinding(findingOrId) {
  const id = typeof findingOrId === 'string' ? findingOrId : findingId(findingOrId);
  if (!id) return [];
  return recentLocalSessions().filter(session => String(session?.subject?.finding_id || '') === String(id));
}

function latestSessionForFinding(findingOrId) {
  return sessionsForFinding(findingOrId)[0] || null;
}

function pendingApprovalsForSession(session) {
  return Array.isArray(session?.approvals)
    ? session.approvals.filter(item => String(item?.state || '').toLowerCase() === 'pending')
    : [];
}

function localTriageLatestRun() {
  return state.localTriage?.orchestrator?.latest || null;
}

function localPendingActions() {
  return Array.isArray(state.localTriage?.queue?.pending) ? state.localTriage.queue.pending : [];
}

function localAppliedActionsCount() {
  return Number(state.localTriage?.queue?.applied_count || 0);
}

function localFindingsArtifact() {
  return state.localTriage?.findings_artifact || null;
}

function localOrchestratorFindings() {
  return Array.isArray(localTriageLatestRun()?.findings) ? localTriageLatestRun().findings : [];
}

function nativeFindingOverride(findingOrId) {
  const id = typeof findingOrId === 'string' ? findingOrId : findingId(findingOrId);
  if (!id) return null;
  return state.nativeFindingOverrides.get(String(id)) || null;
}

function applyNativeFindingStatuses(payload) {
  const statuses = Array.isArray(payload?.native_statuses) ? payload.native_statuses : [];
  const seen = new Set();
  statuses.forEach(item => {
    const id = String(item?.finding_id || '').trim();
    if (!id) return;
    seen.add(id);
    state.nativeFindingOverrides.set(id, {
      status: item.status || 'open',
      disposition: item.disposition || 'unreviewed',
      updated_at: item.updated_at || null
    });
  });
  // A finding that is returned by Core without a native override is allowed
  // to follow its canonical dashboard status again. This prevents a stale
  // in-memory close from surviving after an operator reopens the record.
  for (const id of state.nativeFindingOverrides.keys()) {
    if (!seen.has(String(id))) state.nativeFindingOverrides.delete(id);
  }
}

function effectiveFindingStatus(finding) {
  return nativeFindingOverride(finding)?.status || findingStatus(finding);
}

function effectiveFindingDisposition(finding) {
  return nativeFindingOverride(finding)?.disposition || finding?.disposition || 'unreviewed';
}

function localFindingInsight(findingIdValue) {
  const normalized = String(findingIdValue || '');
  if (!normalized) return null;
  const pendingAction = localPendingActions().find(item => String(item.finding_id || '') === normalized) || null;
  const orchestratorFinding = localOrchestratorFindings().find(item => String(item.finding_id || '') === normalized) || null;
  if (!pendingAction && !orchestratorFinding) return null;
  return { pendingAction, orchestratorFinding };
}

function nativeActionCommand(action) {
  if (!action) return '';
  const id = String(action.action_id || '').trim();
  if (!id) return '';
  const session = latestSessionForFinding(action.finding_id || '');
  const sessionPart = session?.status === 'open' ? ` --session-id ${session.session_id}` : '';
  return `secopsai triage apply-action ${id} --yes${sessionPart}`;
}

function investigateFindingCommand(finding) {
  const id = String(findingId(finding) || '').trim();
  if (!id) return '';
  const root = state.localTriage?.secopsai_root || '/Users/chrixchange/secopsai';
  const session = latestSessionForFinding(finding);
  const sessionPart = session?.status === 'open' ? ` --session-id ${session.session_id}` : ' --open-session';
  return `secopsai triage investigate ${id} --search-root ${root}${sessionPart} --json`;
}

function closeFindingCommand(finding, disposition = 'needs_review', note = 'Analyst review note required.') {
  const id = String(findingId(finding) || '').trim();
  if (!id) return '';
  const normalizedNote = String(note || '').trim().replace(/"/g, '\\"');
  const session = latestSessionForFinding(finding);
  const sessionPart = session?.status === 'open' ? ` --session-id ${session.session_id}` : '';
  return `secopsai triage close ${id} --disposition ${disposition} --status closed --note "${normalizedNote}"${sessionPart}`;
}

function researchFindingCommand(finding) {
  const id = String(findingId(finding) || '').trim();
  if (!id) return '';
  const root = state.localTriage?.secopsai_root || '/Users/chrixchange/secopsai';
  const session = latestSessionForFinding(finding);
  const sessionPart = session?.status === 'open' ? ` --session-id ${session.session_id}` : '';
  return `secopsai research finding ${id} --search-root ${root}${sessionPart}`;
}

function sessionShowCommand(sessionOrId) {
  const id = typeof sessionOrId === 'string' ? sessionOrId : String(sessionOrId?.session_id || '').trim();
  if (!id) return '';
  return `secopsai session show ${id}`;
}

function sessionResumeCommand(sessionOrId, { withResearch = false } = {}) {
  const session = typeof sessionOrId === 'string'
    ? recentLocalSessions().find(item => String(item?.session_id || '') === String(sessionOrId)) || state.selectedSessionDetail
    : sessionOrId;
  const findingIdValue = String(session?.subject?.finding_id || '').trim();
  if (!findingIdValue) return sessionShowCommand(sessionOrId);
  const root = state.localTriage?.secopsai_root || '/Users/chrixchange/secopsai';
  const researchPart = withResearch ? ' --with-research' : '';
  return `secopsai triage investigate ${findingIdValue} --search-root ${root} --session-id ${session.session_id}${researchPart} --json`;
}

async function copyTextWithStatus(text, successMessage) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus(`<span class="dot"></span> ${escapeHtml(successMessage)}`);
  showToast(successMessage, 'success');
}

async function postNativeHelper(path, payload) {
  const response = await dashboardApiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || data?.stderr || data?.stdout || `Request failed (${response.status})`);
  }
  await refreshAfterAction({ key: `native:${path}` });
  return data;
}

async function runNativeInvestigate(finding) {
  const id = String(findingId(finding) || '').trim();
  const session = latestSessionForFinding(finding);
  if (!id) return;
  setStatus(`<span class="dot"></span> Running native investigate for ${escapeHtml(id)}…`);
  const result = await postNativeHelper('/api/secopsai/investigate', {
    finding_id: id,
    session_id: session?.status === 'open' ? session.session_id : null
  });
  const summary =
    result?.result?.investigation?.summary ||
    result?.result?.summary ||
    result?.result?.verdict_explanation?.summary ||
    result?.result?.recommendation?.summary ||
    'Native investigation completed.';
  const sessionSuffix = result?.result?.session_id ? ` (session ${result.result.session_id})` : '';
  setStatus(`<span class="dot"></span> ${escapeHtml(`${summary}${sessionSuffix}`)}`);
  await loadLocalTriageState();
  renderFindings();
  renderEdgeWorkspace();
  renderIntegrations();
}

async function runNativeResearchFinding(finding) {
  const id = String(findingId(finding) || '').trim();
  const session = latestSessionForFinding(finding);
  if (!id) return;
  setStatus(`<span class="dot"></span> Building source-backed research for ${escapeHtml(id)}…`);
  const result = await postNativeHelper('/api/secopsai/research-finding', {
    finding_id: id,
    session_id: session?.status === 'open' ? session.session_id : null,
    search_root: state.localTriage?.secopsai_root || '/Users/chrixchange/secopsai'
  });
  const reportPath =
    result?.result?.markdown_report ||
    result?.result?.json_report ||
    result?.result?.report_path ||
    '';
  const summary = reportPath
    ? `Research ready for ${id} • ${reportPath.split('/').pop()}`
    : `Research ready for ${id}`;
  setStatus(`<span class="dot"></span> ${escapeHtml(summary)}`);
  await loadLocalTriageState();
  renderFindings();
  renderIntegrations();
}

async function runNativeApplyAction(action) {
  const id = String(action?.action_id || '').trim();
  if (!id) return;
  const session = latestSessionForFinding(action?.finding_id || '');
  setStatus(`<span class="dot"></span> Applying native action ${escapeHtml(id)}…`);
  const result = await postNativeHelper('/api/secopsai/apply-action', {
    action_id: id,
    session_id: session?.session_id || null
  });
  const line = String(result?.stdout || '').trim().split('\n').filter(Boolean).pop() || `Applied ${id}`;
  setStatus(`<span class="dot"></span> ${escapeHtml(line)}`);
  await loadLocalTriageState();
  renderFindings();
  renderIntegrations();
  renderRunRequests();
}

async function runNativeCloseFinding(finding, disposition, note, status = 'closed') {
  const id = String(findingId(finding) || '').trim();
  const normalizedDisposition = String(disposition || '').trim();
  const normalizedNote = String(note || '').trim();
  const session = latestSessionForFinding(finding);
  if (!id) return;
  if (normalizedNote.length < 12) {
    throw new Error('Add an analyst note before closing this finding.');
  }
  setStatus(`<span class="dot"></span> Closing ${escapeHtml(id)} in native SecOpsAI…`);
  const result = await postNativeHelper('/api/secopsai/close-finding', {
    finding_id: id,
    disposition: normalizedDisposition,
    note: normalizedNote,
    status,
    session_id: session?.session_id || null
  });
  state.nativeFindingOverrides.set(id, {
    status: result?.status || status,
    disposition: result?.disposition || normalizedDisposition,
    note: result?.note || normalizedNote
  });
  state.nativeCloseDraft = null;
  const line = String(result?.stdout || '').trim().split('\n').filter(Boolean).pop() || `Closed ${id}`;
  await loadLocalTriageState();
  const persisted = nativeFindingOverride(id);
  if (!persisted || String(persisted.status || '').toLowerCase() !== String(status).toLowerCase()) {
    throw new Error(`SecOpsAI did not confirm ${id} as ${status}`);
  }
  setStatus(`<span class="dot"></span> ${escapeHtml(line)} · confirmed after reload`);
  renderFindings();
  renderIntegrations();
}

async function runNativeResolveApproval(sessionId, approvalId, { decision = 'approved', apply = true, note = '', decidedBy = 'dashboard' } = {}) {
  const normalizedSessionId = String(sessionId || '').trim();
  const normalizedApprovalId = String(approvalId || '').trim();
  const normalizedDecision = String(decision || '').trim().toLowerCase();
  if (!normalizedSessionId || !normalizedApprovalId) return;
  setStatus(`<span class="dot"></span> ${escapeHtml(humanizeSnake(normalizedDecision))} approval ${escapeHtml(normalizedApprovalId)}…`);
  const result = await postNativeHelper('/api/secopsai/resolve-approval', {
    session_id: normalizedSessionId,
    approval_id: normalizedApprovalId,
    decision: normalizedDecision,
    apply,
    note,
    decided_by: decidedBy
  });
  const summary =
    result?.result?.applied?.result?.summary ||
    result?.result?.approval?.summary ||
    `${humanizeSnake(normalizedDecision)} ${normalizedApprovalId}`;
  setStatus(`<span class="dot"></span> ${escapeHtml(summary)}`);
  await loadLocalTriageState();
  renderFindings();
  renderIntegrations();
  renderRunRequests();
}

async function loadSessionDetail(sessionId) {
  const normalized = String(sessionId || '').trim();
  if (!normalized) {
    state.selectedSessionDetail = null;
    return null;
  }
  const response = await dashboardApiFetch(`/api/secopsai/session?session_id=${encodeURIComponent(normalized)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Session detail HTTP ${response.status}`);
  }
  state.selectedSessionDetail = data.session || null;
  return state.selectedSessionDetail;
}

async function refreshSelectedSessionDetail() {
  const recent = recentLocalSessions();
  if (!recent.length) {
    state.selectedSessionId = null;
    state.selectedSessionDetail = null;
    return null;
  }
  if (!state.selectedSessionId || !recent.some(item => String(item?.session_id || '') === String(state.selectedSessionId))) {
    state.selectedSessionId = String(recent[0]?.session_id || '').trim() || null;
  }
  if (!state.selectedSessionId) {
    state.selectedSessionDetail = null;
    return null;
  }
  try {
    return await loadSessionDetail(state.selectedSessionId);
  } catch (error) {
    console.warn('session detail load failed', error);
    state.selectedSessionDetail = null;
    return null;
  }
}

async function selectNativeSession(sessionId, { focusFinding = false } = {}) {
  state.selectedSessionId = String(sessionId || '').trim() || null;
  if (!state.selectedSessionId) {
    state.selectedSessionDetail = null;
    renderIntegrations();
    return;
  }
  await refreshSelectedSessionDetail();
  if (focusFinding) {
    const findingIdValue = String(state.selectedSessionDetail?.subject?.finding_id || '').trim();
    if (findingIdValue) {
      selectFinding(findingIdValue);
      renderFindings();
    }
  }
  renderIntegrations();
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function humanizeMachineText(value) {
  return String(value || '')
    .replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/gi, token => token.replace(/_+/g, ' '))
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function securitySourceLabel(value) {
  const raw = String(value || '').trim();
  const known = {
    'secopsai-supply-chain': 'SecOpsAI Supply Chain',
    'secopsai_research': 'SecOpsAI Research',
    'secopsai_edge': 'SecOpsAI Edge',
    'secopsai-edge': 'SecOpsAI Edge',
  };
  return known[raw] || humanizeSnake(raw.replace(/-+/g, ' ')) || 'Unknown source';
}

function setButtonBusy(buttonOrId, busy, busyLabel = 'Working…') {
  const btn = typeof buttonOrId === 'string' ? el(buttonOrId) : buttonOrId;
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.originalLabel) btn.dataset.originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.classList.add('is-loading');
    btn.innerHTML = busyLabel;
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.classList.remove('is-loading');
    if (btn.dataset.originalLabel) {
      btn.innerHTML = btn.dataset.originalLabel;
      delete btn.dataset.originalLabel;
    }
  }
}

async function runRefreshAction(buttonOrId, action, {
  busyLabel = 'Refreshing…',
  successMessage = 'Data refreshed',
  errorMessage = 'Refresh failed'
} = {}) {
  const originalButton = typeof buttonOrId === 'string' ? el(buttonOrId) : buttonOrId;
  const buttonId = originalButton?.id || (typeof buttonOrId === 'string' ? buttonOrId : '');
  const originalLabel = originalButton?.innerHTML || '';
  setButtonBusy(originalButton, true, busyLabel);
  try {
    const result = await action();
    showToast(successMessage, 'success', 2600);
    return result;
  } catch (error) {
    const detail = error?.message || String(error);
    console.error(`${errorMessage.toLowerCase()}:`, error);
    setStatus(`${errorMessage}: ${detail}`, true);
    showToast(`${errorMessage}: ${detail}`, 'error');
    return null;
  } finally {
    const currentButton = buttonId ? el(buttonId) : originalButton;
    if (currentButton && !currentButton.dataset.originalLabel && originalLabel) {
      currentButton.dataset.originalLabel = originalLabel;
    }
    setButtonBusy(currentButton, false);
  }
}

// Actions that hand work to a local worker or hosted workflow can finish after
// the POST response. Keep the visible surface current without requiring the
// operator to press Refresh again.
const ACTION_AUTO_REFRESH_INTERVAL_MS = 3000;
const ACTION_AUTO_REFRESH_MAX_MS = 5 * 60 * 1000;

function stopActionAutoRefresh(key, entry = null) {
  const current = state.actionAutoRefresh.get(key);
  if (!current || (entry && current !== entry)) return;
  if (current.timer) window.clearTimeout(current.timer);
  state.actionAutoRefresh.delete(key);
}

function scheduleActionAutoRefresh(
  key,
  refresh,
  {
    intervalMs = ACTION_AUTO_REFRESH_INTERVAL_MS,
    maxMs = ACTION_AUTO_REFRESH_MAX_MS,
    isComplete = () => false,
    onTimeout = null
  } = {}
) {
  const normalizedKey = String(key || 'current-surface');
  stopActionAutoRefresh(normalizedKey);
  const entry = {
    startedAt: Date.now(),
    timer: null,
    inFlight: false
  };
  state.actionAutoRefresh.set(normalizedKey, entry);

  const tick = async () => {
    if (state.actionAutoRefresh.get(normalizedKey) !== entry) return;
    if (entry.inFlight) {
      entry.timer = window.setTimeout(tick, intervalMs);
      return;
    }
    entry.inFlight = true;
    try {
      await refresh();
    } catch (error) {
      // A transient refresh failure should not strand the button or stop the
      // next attempt. The normal surface error state remains authoritative.
      console.warn('post-action auto-refresh failed', normalizedKey, error);
    } finally {
      entry.inFlight = false;
    }
    if (state.actionAutoRefresh.get(normalizedKey) !== entry) return;
    if (isComplete()) {
      stopActionAutoRefresh(normalizedKey, entry);
      return;
    }
    if (Date.now() - entry.startedAt >= maxMs) {
      stopActionAutoRefresh(normalizedKey, entry);
      if (typeof onTimeout === 'function') onTimeout();
      return;
    }
    entry.timer = window.setTimeout(tick, intervalMs);
  };

  entry.timer = window.setTimeout(tick, intervalMs);
  return () => stopActionAutoRefresh(normalizedKey, entry);
}

async function refreshAfterAction({
  key = `surface:${currentPageFromLocation()}`,
  poll = false,
  refresh = () => refreshActiveSurface({ force: true }),
  isComplete = () => false,
  maxMs = ACTION_AUTO_REFRESH_MAX_MS,
  onTimeout = null
} = {}) {
  try {
    await refresh();
  } catch (error) {
    console.warn('post-action refresh failed', key, error);
  }
  if (poll) {
    scheduleActionAutoRefresh(key, refresh, { isComplete, maxMs, onTimeout });
  }
}

function setStatus(message, isError = false) {
  const target = el('global-status');
  if (!target) return;
  target.innerHTML = isError ? `<span class="error">${escapeHtml(message)}</span>` : message;
}

function showToast(message, tone = 'info', timeout = 4200) {
  const region = el('toast-region');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${tone}`;
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${tone === 'success' ? '✓' : tone === 'error' ? '!' : 'i'}</span><span>${escapeHtml(String(message || ''))}</span><button type="button" aria-label="Dismiss notification">✕</button>`;
  toast.querySelector('button')?.addEventListener('click', () => toast.remove());
  region.appendChild(toast);
  window.setTimeout(() => toast.remove(), timeout);
}

let confirmationResolver = null;

function requestConfirmation(message, {
  title = 'Confirm action',
  eyebrow = 'Action review',
  context = 'This action will be recorded in the activity history.',
  confirmLabel = 'Continue',
  danger = false
} = {}) {
  const modal = el('confirm-dialog');
  if (!modal) return Promise.resolve(false);
  if (confirmationResolver) confirmationResolver(false);
  return new Promise(resolve => {
    confirmationResolver = resolve;
    el('confirm-dialog-eyebrow').textContent = eyebrow;
    el('confirm-dialog-title').textContent = title;
    el('confirm-dialog-message').textContent = message;
    el('confirm-dialog-context').textContent = context;
    const confirmButton = el('confirm-dialog-confirm');
    confirmButton.textContent = confirmLabel;
    confirmButton.classList.toggle('danger-btn', danger);
    confirmButton.classList.toggle('primary-btn', !danger);
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    confirmButton.focus();
  });
}

function finishConfirmation(result) {
  const modal = el('confirm-dialog');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  const resolver = confirmationResolver;
  confirmationResolver = null;
  resolver?.(Boolean(result));
}

function notifyError(message) {
  setStatus(String(message || 'Action failed'), true);
  showToast(String(message || 'Action failed'), 'error');
}

function updateTopStrip(pageId) {
  const context = el('top-strip-context');
  if (context) context.textContent = PAGE_CONTEXT[pageId] || 'SecOpsAI dashboard';
}

function pageIdForRoute(route) {
  const normalized = String(route || '').replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase() || 'overview';
  return ROUTE_PAGES[normalized] || (pages.includes(normalized) ? normalized : 'mission-control');
}

function researchViewForRoute(route) {
  const normalized = String(route || '').replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase();
  const match = Object.entries(RESEARCH_VIEW_ROUTES).find(([, value]) => value === normalized);
  return match?.[0] || 'cases';
}

function blogViewForRoute(route) {
  const normalized = String(route || '').replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase();
  const match = Object.entries(BLOG_VIEW_ROUTES).find(([, value]) => value === normalized);
  return match?.[0] || 'review';
}

function systemViewForRoute(route) {
  const normalized = String(route || '').replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase();
  const match = Object.entries(SYSTEM_VIEW_ROUTES).find(([, value]) => value === normalized);
  return match?.[0] || 'health';
}

function assetViewForRoute(route) {
  const normalized = String(route || '').replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase();
  const match = Object.entries(ASSET_VIEW_ROUTES).find(([, value]) => value === normalized);
  return match?.[0] || 'inventory';
}

function automationViewForRoute(route) {
  const normalized = String(route || '').replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase();
  const match = Object.entries(AUTOMATION_VIEW_ROUTES).find(([, value]) => value === normalized);
  return match?.[0] || 'models';
}

function routeForPage(pageId) {
  if (pageId === 'research-cases') return RESEARCH_VIEW_ROUTES[state.researchCases.view || 'cases'] || RESEARCH_VIEW_ROUTES.cases;
  if (pageId === 'blog-ops') return BLOG_VIEW_ROUTES[state.blogOps.view || 'review'] || BLOG_VIEW_ROUTES.review;
  if (pageId === 'integrations') return SYSTEM_VIEW_ROUTES[state.integrationView || 'health'] || SYSTEM_VIEW_ROUTES.health;
  if (pageId === 'edge') return ASSET_VIEW_ROUTES[state.edgeWorkspace.view || 'inventory'] || ASSET_VIEW_ROUTES.inventory;
  if (pageId === 'automation') return AUTOMATION_VIEW_ROUTES[state.intelligence.view || 'models'] || AUTOMATION_VIEW_ROUTES.models;
  return PAGE_ROUTES[pageId] || PAGE_ROUTES.mission-control;
}

function currentPageFromLocation() {
  const route = window.location.hash || 'overview';
  if (String(route).replace(/^#\/?/, '').startsWith('research/')) {
    state.researchCases.view = researchViewForRoute(route);
  }
  if (String(route).replace(/^#\/?/, '').startsWith('publications/')) {
    state.blogOps.view = blogViewForRoute(route);
  }
  if (String(route).replace(/^#\/?/, '').startsWith('system/') && String(route).replace(/^#\/?/, '') !== 'system/automation') {
    state.integrationView = systemViewForRoute(route);
  }
  if (String(route).replace(/^#\/?/, '').startsWith('assets/')) {
    state.edgeWorkspace.view = assetViewForRoute(route);
  }
  if (String(route).replace(/^#\/?/, '').startsWith('automation/')) {
    state.intelligence.view = automationViewForRoute(route);
  }
  return pageIdForRoute(route);
}

function renderContextNav(pageId, routeOverride = null) {
  const host = el('context-nav');
  if (!host) return;
  // Route choices now live under the active primary section in the sidebar.
  // Keep this empty for a clean top bar and retain CONTEXT_NAV as the
  // compatibility registry used by route tests and legacy deep links.
  host.innerHTML = '';
  host.hidden = true;
}

function helpCopyForPage(pageId) {
  const copies = {
    'mission-control': ['Overview', 'Start here. Review the items that need attention, then follow each record into Findings, Work, Assets, or Research.'],
    findings: ['Findings', 'A finding is a canonical security issue. Read its evidence and history before assigning work, changing status, or creating a research case.'],
    edge: ['Assets', 'Assets show what the local sensor has observed. Use Changes to answer what is new, missing, or exposed, then link back to the related finding.'],
    tasks: ['Work', 'Work is where humans own remediation, approvals, and investigation outcomes. The dashboard records state; local runtimes perform execution.'],
    'triage-ops': ['Supply-chain review', 'Use read-only evidence actions first. Separate package maliciousness from local impact, then create a Research case only when the lead deserves durable investigation.'],
    'research-cases': ['Research', 'Research cases preserve evidence, indicators, disclosure decisions, and publication readiness. Protected actions always require explicit review.'],
    coverage: ['Global coverage', 'Registry collectors record every observed package event. Watch cursor lag, coverage gaps, and dead letters here; a paused or degraded collector means surveillance is incomplete, not clean.'],
    'blog-ops': ['Publications', 'Publications are editorial output. Review claims, references, IOCs, and safety blockers before approval, staging, or deployment.'],
    automation: ['Automation', 'Automation configures model-assisted analysis, guarded decision policy, investigation pipelines, and detection learning. Review results and policy boundaries here; final publication remains an operator decision.'],
    integrations: ['System', 'System explains the health of the dashboard, Core, Edge, helper, and action boundaries. Resolve degraded integrations before relying on their data.'],
    'operator-guide': ['Help', 'Use the operator guide for detailed click paths, safety boundaries, and recovery steps.']
  };
  return copies[pageId] || copies['mission-control'];
}

function operatorGuidanceFor(pageId, activeRoute) {
  const route = String(activeRoute || '').replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase();
  const pageFallbacks = {
    tasks: 'work',
    edge: 'assets',
    'triage-ops': 'findings/supply-chain',
    'coverage': 'research/coverage',
    'blog-ops': 'publications',
    automation: 'automation/models',
    integrations: 'system/health'
  };
  return OPERATOR_GUIDANCE[route]
    || OPERATOR_GUIDANCE[pageFallbacks[pageId]]
    || (route.startsWith('publications/') ? OPERATOR_GUIDANCE.publications : null)
    || null;
}

function renderOperatorGuidance(pageId, activeRoute) {
  document.querySelectorAll('.operator-decision-guide').forEach(node => node.remove());
  if (['mission-control', 'operator-guide'].includes(pageId)) return;
  const guidance = operatorGuidanceFor(pageId, activeRoute);
  const page = el(`page-${pageId}`);
  const header = page?.querySelector(':scope > .page-header');
  if (!guidance || !header) return;
  const guide = document.createElement('section');
  guide.className = 'operator-decision-guide';
  guide.setAttribute('aria-label', 'Recommended next step');
  guide.innerHTML = `
    <div class="operator-guide-main">
      <span class="eyebrow">Recommended next step</span>
      <h3>${escapeHtml(guidance.title)}</h3>
      <p>${escapeHtml(guidance.detail)}</p>
    </div>
    <div class="operator-guide-boundary">
      <span><strong>SecOpsAI handles</strong>${escapeHtml(guidance.automation)}</span>
      <span><strong>You decide</strong>${escapeHtml(guidance.approval)}</span>
    </div>
    <button class="primary-btn operator-guide-action" type="button">${escapeHtml(guidance.action)}</button>`;
  guide.querySelector('.operator-guide-action')?.addEventListener('click', () => {
    const target = guidance.target ? el(guidance.target) : null;
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.focus?.({ preventScroll: true });
    } else {
      scrollPrimaryPageToTop();
    }
  });
  header.insertAdjacentElement('afterend', guide);
}

function openHelpDrawer(pageId = currentPageFromLocation()) {
  const drawer = el('help-drawer');
  const title = el('help-drawer-title');
  const body = el('help-drawer-body');
  if (!drawer || !title || !body) return;
  const [heading, copy] = helpCopyForPage(pageId);
  title.textContent = heading;
  body.querySelector('p').textContent = copy;
  drawer.hidden = false;
  drawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('help-drawer-open');
  el('help-drawer-close')?.focus();
}

function closeHelpDrawer() {
  const drawer = el('help-drawer');
  if (!drawer) return;
  drawer.hidden = true;
  drawer.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('help-drawer-open');
}

function enhanceResponsiveTables(root = document) {
  root.querySelectorAll?.('.table-wrap table').forEach(table => {
    table.classList.add('mobile-card-table');
    const labels = [...table.querySelectorAll('thead th')].map(cell => String(cell.textContent || '').trim() || 'Value');
    table.querySelectorAll('tbody tr').forEach(row => {
      [...row.children].forEach((cell, index) => {
        if (!cell.dataset.label) cell.dataset.label = labels[index] || 'Value';
      });
    });
  });
}

let commandPaletteIndex = 0;
function renderCommandPalette(query = '') {
  const host = el('command-palette-list');
  if (!host) return;
  const normalized = String(query || '').trim().toLowerCase();
  const filtered = COMMANDS.filter(([label, description]) => `${label} ${description}`.toLowerCase().includes(normalized));
  commandPaletteIndex = Math.min(commandPaletteIndex, Math.max(0, filtered.length - 1));
  host.innerHTML = filtered.length ? filtered.map(([label, description, page], index) => `
    <button class="command-item ${index === commandPaletteIndex ? 'selected' : ''}" type="button" data-command-page="${escapeHtml(page)}">
      <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(description)}</small></span><kbd>↵</kbd>
    </button>
  `).join('') : '<div class="command-empty">No matching destination.</div>';
  host.querySelectorAll('[data-command-page]').forEach(button => {
    button.addEventListener('click', () => {
      closeCommandPalette();
      setPage(button.dataset.commandPage);
    });
  });
}

function openCommandPalette() {
  const palette = el('command-palette');
  if (!palette) return;
  commandPaletteIndex = 0;
  renderCommandPalette('');
  palette.classList.remove('hidden');
  palette.setAttribute('aria-hidden', 'false');
  el('command-palette-input')?.focus();
}

function closeCommandPalette() {
  const palette = el('command-palette');
  if (!palette) return;
  palette.classList.add('hidden');
  palette.setAttribute('aria-hidden', 'true');
  el('top-search-btn')?.focus();
}

function updateTopStripClock() {
  const clock = el('top-strip-time');
  if (!clock) return;
  clock.textContent = new Date().toLocaleTimeString('en-US', {
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function startTopStripClock() {
  updateTopStripClock();
  window.setInterval(updateTopStripClock, 1000);
}

function setPage(pageId, { skipHistory = false, routeOverride = null, scrollToTarget = true } = {}) {
  const normalizedPageId = pages.includes(pageId) ? pageId : pageIdForRoute(pageId);
  if (normalizedPageId !== 'findings') closeFindingReview();
  if (normalizedPageId === 'research-cases' && routeOverride) state.researchCases.view = researchViewForRoute(routeOverride);
  if (normalizedPageId === 'blog-ops' && routeOverride) state.blogOps.view = blogViewForRoute(routeOverride);
  if (normalizedPageId === 'integrations' && routeOverride) state.integrationView = systemViewForRoute(routeOverride);
  if (normalizedPageId === 'edge' && routeOverride) state.edgeWorkspace.view = assetViewForRoute(routeOverride);
  if (normalizedPageId === 'automation' && routeOverride) state.intelligence.view = automationViewForRoute(routeOverride);
  pages.forEach((id) => {
    const page = el(`page-${id}`);
    if (page) page.classList.toggle("active", id === normalizedPageId);
  });
  const activeTopPage = primaryPageFor(normalizedPageId);
  const activeRoute = routeOverride || routeForPage(normalizedPageId);
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const buttonRoute = String(btn.dataset.route || '');
    const matchesPage = btn.dataset.page === activeTopPage;
    const matchesExactRoute = buttonRoute && buttonRoute.includes('/') && buttonRoute === activeRoute;
    const matchesSystemFallback = buttonRoute === 'system' && activeRoute.startsWith('system');
    const matchesResearchFallback = buttonRoute === 'research/cases' && activeRoute.startsWith('research/');
    const matchesPublicationFallback = buttonRoute === 'publications' && activeRoute.startsWith('publications/');
    const matchesAssetFallback = buttonRoute === 'assets' && activeRoute.startsWith('assets/');
    btn.classList.toggle("active", matchesPage && (matchesExactRoute || matchesSystemFallback || matchesResearchFallback || matchesPublicationFallback || matchesAssetFallback || !buttonRoute.includes('/')));
  });
  document.body.classList.remove('mobile-nav-open');
  el('mobile-menu-btn')?.setAttribute('aria-expanded', 'false');
  updateTopStrip(normalizedPageId);
  renderContextNav(normalizedPageId, activeRoute);
  if (normalizedPageId === 'research-cases') renderResearchCases();
  if (normalizedPageId === 'blog-ops') renderBlogOps();
  if (normalizedPageId === 'automation') renderAutomation();
  if (normalizedPageId === 'integrations') renderIntegrations();
  if (normalizedPageId === 'enterprise') renderEnterprise();
  if (normalizedPageId === 'edge') renderEdgeWorkspace();
  if (normalizedPageId === 'triage-ops') {
    renderTriageOps();
    if (state.auth.activeUserId) {
      loadTriageOpsAlerts({ render: false }).then(() => renderTriageOps()).catch(error => console.warn('Triage Ops navigation refresh failed', error));
    }
  }
  if (normalizedPageId === 'coverage') {
    renderCoverage();
    if (state.auth.activeUserId) {
      loadCoverage({ render: false }).then(() => renderCoverage()).catch(error => console.warn('coverage navigation refresh failed', error));
    }
  }
  renderSidebarSubnav(normalizedPageId, activeRoute);
  renderOperatorGuidance(normalizedPageId, activeRoute);
  if (!skipHistory && window.history?.pushState) {
    const nextHash = `#${routeOverride || routeForPage(normalizedPageId)}`;
    if (window.location.hash !== nextHash) window.history.pushState({ page: normalizedPageId }, '', nextHash);
  }
  if (scrollToTarget) scrollToContextTarget(routeOverride || routeForPage(normalizedPageId));
  else scrollPrimaryPageToTop();
}

function toggleMobileNav() {
  const isOpen = document.body.classList.toggle('mobile-nav-open');
  el('mobile-menu-btn')?.setAttribute('aria-expanded', String(isOpen));
}

function roleDepartment(role) {
  if (!role) return "exec";
  return role.split("/")[0] || "exec";
}

function latestRunByRole(runs) {
  const map = new Map();
  for (const run of runs) {
    const prev = map.get(run.role_label);
    if (!prev || new Date(run.created_at) > new Date(prev.created_at)) map.set(run.role_label, run);
  }
  return map;
}

function statusLabel(status) {
  return humanizeMachineText(String(status || '').replace(/-+/g, ' '));
}

function getTaskFilters() {
  return {
    scope: el('task-filter-scope')?.value || 'operator',
    search: (el('task-search')?.value || '').trim().toLowerCase(),
    domain: el('task-filter-domain')?.value || '',
    priority: el('task-filter-priority')?.value || '',
    status: el('task-filter-status')?.value || '',
    owner: (el('task-filter-owner')?.value || '').trim().toLowerCase(),
    reviewer: (el('task-filter-reviewer')?.value || '').trim().toLowerCase(),
    external: !!el('task-filter-external')?.checked,
    security: !!el('task-filter-security')?.checked
  };
}

function isInternalDevelopmentRecord(item = {}) {
  const explicit = String(item.work_type || item.category || item.source_type || '').toLowerCase();
  if (['development', 'engineering', 'product_delivery', 'internal'].includes(explicit)) return true;
  const labels = Array.isArray(item.labels) ? item.labels.map(value => String(value).toLowerCase()) : [];
  if (labels.some(label => ['development', 'engineering', 'internal', 'dashboard'].includes(label))) return true;
  const text = `${item.title || ''} ${item.task_summary || ''}`.toLowerCase();
  return /\b(?:implement|implementation|wire|wiring|refactor|dashboard demo|sample operational data|build pipeline|test fixture|frontend|backend)\b/.test(text);
}

function isOperatorWorkItem(item = {}) {
  const linkedSecurityRecord = Boolean(item.finding_id || item.research_case_id || item.case_id || item.alert_id || item.asset_id);
  if (linkedSecurityRecord) return true;
  if (isInternalDevelopmentRecord(item)) return false;
  return linkedSecurityRecord || Boolean(item.external_facing) || Boolean(item.requires_security_review) || ['blocked', 'review'].includes(String(item.status || ''));
}

function applyFindingSavedView(view = 'all', { persist = false } = {}) {
  ['finding-search', 'finding-filter-severity', 'finding-filter-status', 'finding-filter-source'].forEach(id => { if (el(id)) el(id).value = ''; });
  if (view === 'open' && el('finding-filter-status')) el('finding-filter-status').value = 'open';
  if (view === 'priority' && el('finding-filter-severity')) el('finding-filter-severity').value = 'priority';
  if (view === 'edge' && el('finding-filter-source')) el('finding-filter-source').value = 'secopsai_edge';
  if (view === 'supply-chain' && el('finding-filter-source')) el('finding-filter-source').value = 'supply_chain_all';
  if (persist) localStorage.setItem('secopsai_findings_saved_view', view || 'all');
}

function restoreFindingSavedView() {
  const allowed = new Set(['open', 'priority', 'edge', 'supply-chain', 'all']);
  const saved = localStorage.getItem('secopsai_findings_saved_view') || 'all';
  applyFindingSavedView(allowed.has(saved) ? saved : 'all');
}

function filteredWorkItems() {
  const filters = getTaskFilters();
  return state.workItems.filter(item => {
    if (filters.scope === 'operator') {
      if (!isOperatorWorkItem(item)) return false;
    }
    if (filters.domain && item.domain !== filters.domain) return false;
    if (filters.priority && item.priority !== filters.priority) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.owner && !(item.owner_role || '').toLowerCase().includes(filters.owner)) return false;
    if (filters.reviewer && !(item.reviewer_role || '').toLowerCase().includes(filters.reviewer)) return false;
    if (filters.external && !item.external_facing) return false;
    if (filters.security && !item.requires_security_review) return false;
    if (filters.search) {
      const hay = `${item.title || ''} ${item.description || ''} ${item.owner_role || ''} ${item.reviewer_role || ''}`.toLowerCase();
      if (!hay.includes(filters.search)) return false;
    }
    return true;
  });
}

function renderStatusPill(status, label = null) {
  const raw = String(status || 'unknown').toLowerCase();
  const safeClass = raw.replace(/[^a-z0-9_-]+/g, '-');
  return `<span class="status-pill status-${safeClass}"><span class="dot"></span> ${escapeHtml(label || statusLabel(raw))}</span>`;
}

function renderSeverityPill(severity) {
  return renderStatusPill(severity || 'unknown', severity || 'unknown');
}

function optionalLoadTable(table, options = {}) {
  return loadTable(table, options)
    .then(data => {
      state.optionalTables[table] = true;
      return data;
    })
    .catch(error => {
      console.warn(`optional table load failed: ${table}`, error);
      state.optionalTables[table] = false;
      return [];
    });
}

function findingId(finding) {
  // Core records may contain an internal database id alongside the stable
  // public finding_id. Guarded CLI actions accept the latter; preferring the
  // internal id makes close/investigate actions fail with "Invalid finding_id".
  return finding?.finding_id || finding?.id || finding?.uuid || finding?.event_id || null;
}

function findingSeverity(finding) {
  return finding?.severity || finding?.priority || finding?.risk_level || 'unknown';
}

function findingTitle(finding) {
  return finding?.title || finding?.name || finding?.summary || finding?.indicator || finding?.rule_name || 'Untitled finding';
}

function findingBody(finding) {
  return finding?.summary || finding?.description || finding?.details || finding?.evidence_summary || '';
}

function findingStatus(finding) {
  return finding?.status || finding?.triage_status || finding?.state || 'open';
}

function findingSource(finding) {
  return finding?.source || finding?.source_name || finding?.vendor || finding?.provider || finding?.detector || finding?.tool || 'Unknown source';
}

function findingPayload(finding) {
  const raw = finding?.payload_json || finding?.payload || finding?.details_json || null;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function findingValue(finding, key) {
  const payload = findingPayload(finding);
  return finding?.[key] ?? payload?.[key] ?? null;
}

function findingArrayValue(finding, key) {
  const value = findingValue(finding, key);
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.split(/\n+/).map(item => item.trim()).filter(Boolean);
  return [];
}

function isAiDependencyGuardFinding(finding) {
  const source = String(findingSource(finding) || '').toLowerCase();
  const id = String(findingId(finding) || '').toUpperCase();
  const rules = findingArrayValue(finding, 'rule_ids').map(item => String(item).toUpperCase());
  const classification = String(findingValue(finding, 'classification') || '').toLowerCase();
  return source === 'secopsai-ai-dependency-guard'
    || id.startsWith('AIDG-')
    || rules.includes('AI-DEPENDENCY-GUARD')
    || ['missing_or_hallucinated', 'newly_registered', 'name_similarity_risk'].includes(classification);
}

function aiDependencyGuardFindings(findings = sortedFindings()) {
  return findings.filter(isAiDependencyGuardFinding);
}

function aiDependencyGuardCliFallback() {
  return 'secopsai supply-chain ai-dependency-guard --path . --include-agent-logs --json';
}

function renderAiDependencyGuardSurface(findings) {
  const guardFindings = aiDependencyGuardFindings(findings);
  const latest = guardFindings[0] || null;
  const highRisk = guardFindings.filter(item => ['high', 'critical', 'urgent'].includes(String(findingSeverity(item)).toLowerCase())).length;
  return `
    <div class="card finding-detail-card">
      <h4>AI Dependency Guard</h4>
      <div class="kv-list">
        <div class="kv-row"><div class="kv-key">Loaded risks</div><div class="kv-val">${escapeHtml(String(guardFindings.length))}</div></div>
        <div class="kv-row"><div class="kv-key">High risk</div><div class="kv-val">${escapeHtml(String(highRisk))}</div></div>
        <div class="kv-row"><div class="kv-key">Latest</div><div class="kv-val">${latest ? `${escapeHtml(findingTitle(latest))} • ${escapeHtml(fmtDate(findingDetectedAt(latest)))}` : 'No persisted guard findings loaded yet'}</div></div>
      </div>
      <div class="small" style="margin-top:12px;">Run <code>${escapeHtml(aiDependencyGuardCliFallback())}</code> locally. The guard warns by default and only fails CI when <code>--fail-on high</code> or <code>--fail-on critical</code> is set.</div>
    </div>
  `;
}

function renderAiDependencyGuardDetail(finding) {
  if (!isAiDependencyGuardFinding(finding)) return '';
  const ecosystem = findingValue(finding, 'ecosystem') || 'unknown';
  const packageName = findingValue(finding, 'package') || findingValue(finding, 'package_name') || 'unknown';
  const classification = findingValue(finding, 'classification') || 'needs_review';
  const registry = findingValue(finding, 'registry') || {};
  const evidence = findingArrayValue(finding, 'evidence').map(item => {
    if (typeof item === 'object' && item !== null) {
      return [item.kind, item.value, item.path, item.detail || item.description].filter(Boolean).join(' • ');
    }
    return String(item);
  });
  const recommendations = findingArrayValue(finding, 'recommended_mitigation');
  const aiOrigin = findingValue(finding, 'ai_origin');
  const manifestOrigin = findingValue(finding, 'manifest_origin');
  return `
    <div class="card finding-detail-card" style="margin-top:14px;">
      <h4>AI Dependency Guard evidence</h4>
      <div class="kv-list">
        <div class="kv-row"><div class="kv-key">Package</div><div class="kv-val">${escapeHtml(ecosystem)}:${escapeHtml(packageName)}</div></div>
        <div class="kv-row"><div class="kv-key">Classification</div><div class="kv-val">${escapeHtml(humanizeSnake(classification))}</div></div>
        <div class="kv-row"><div class="kv-key">AI-origin evidence</div><div class="kv-val">${escapeHtml(aiOrigin ? 'yes' : 'no')}</div></div>
        <div class="kv-row"><div class="kv-key">Manifest evidence</div><div class="kv-val">${escapeHtml(manifestOrigin ? 'yes' : 'no')}</div></div>
        <div class="kv-row"><div class="kv-key">Registry</div><div class="kv-val">${escapeHtml(registry?.metadata_url || (registry?.exists === false ? 'missing from registry metadata' : registry?.latest_version || 'not available'))}</div></div>
      </div>
      <h4 style="margin-top:14px;">Source evidence</h4>
      ${renderBulletList(evidence, 'No structured source evidence was included. Re-run the guard with JSON output for full context.')}
      <h4 style="margin-top:14px;">Recommended action</h4>
      ${renderBulletList(recommendations, 'Verify the package name against official documentation, tune allowlists for private packages, and scan again before install.')}
    </div>
  `;
}

function compactPathLabel(value) {
  const text = String(value || '').trim();
  if (!text) return 'Unknown source';
  if (!text.includes('/')) return text;
  const parts = text.split('/').filter(Boolean);
  if (parts.length <= 3) return text;
  return `…/${parts.slice(-3).join('/')}`;
}

function displayFindingSource(finding) {
  const source = String(findingSource(finding) || '').trim();
  if (!source) return 'Unknown source';
  if (source.startsWith('/')) return compactPathLabel(source);
  return source;
}

function findingConfidence(finding) {
  return finding?.confidence ?? finding?.score ?? finding?.confidence_score ?? null;
}

function findingDetectedAt(finding) {
  return latestFirstDateValue(finding, FINDING_LATEST_FIELDS);
}

function findingFingerprint(finding) {
  return finding?.fingerprint || finding?.dedupe_key || finding?.indicator || finding?.ioc || finding?.hostname || finding?.asset || null;
}

function findingDomainHint(finding) {
  const text = `${findingTitle(finding)} ${findingBody(finding)} ${findingSource(finding)}`.toLowerCase();
  if (["phish", "credential", "malware", "cve", "ransom", "threat", "vuln", "ioc", "alert"].some(x => text.includes(x))) return 'security';
  if (["deploy", "infra", "pipeline", "service", "backend"].some(x => text.includes(x))) return 'platform';
  if (["build", "ci", "dependency", "package", "artifact"].some(x => text.includes(x))) return 'platform';
  return 'security';
}

function findingExplicitTaskIds(finding) {
  const raw = [
    finding?.related_work_item_id,
    finding?.work_item_id,
    finding?.linked_work_item_id,
    finding?.task_id,
    finding?.linked_task_id,
    ...(Array.isArray(finding?.related_work_item_ids) ? finding.related_work_item_ids : []),
    ...(Array.isArray(finding?.linked_task_ids) ? finding.linked_task_ids : [])
  ].filter(Boolean).map(String);
  return [...new Set(raw)];
}

function tokenizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 4)
    .filter(token => !['with','from','that','this','have','been','into','about','their','review','finding','status','severity','source','unknown'].includes(token));
}

function findingTaskMatches(finding) {
  const explicitIds = new Set(findingExplicitTaskIds(finding));
  const titleTokens = tokenizeForMatch(findingTitle(finding));
  const bodyTokens = tokenizeForMatch(findingBody(finding)).slice(0, 12);
  const sourceTokens = tokenizeForMatch(findingSource(finding)).slice(0, 4);
  const fingerprint = String(findingFingerprint(finding) || '').toLowerCase();
  const desiredDomain = findingDomainHint(finding);

  return state.workItems.map(item => {
    let score = 0;
    const reasons = [];
    const hay = `${item.title || ''} ${item.description || ''} ${item.owner_role || ''} ${item.reviewer_role || ''}`.toLowerCase();
    if (!hay.trim()) return null;

    if (explicitIds.has(String(item.id))) {
      score += 120;
      reasons.push('explicit link');
    }
    if (item.linked_run_id && String(item.linked_run_id) === String(finding?.related_run_id || finding?.run_id || '')) {
      score += 35;
      reasons.push('same run');
    }
    if (item.domain === desiredDomain) {
      score += 8;
      reasons.push(`${desiredDomain} domain`);
    }
    const titleHits = titleTokens.filter(token => hay.includes(token));
    const bodyHits = bodyTokens.filter(token => hay.includes(token));
    const sourceHits = sourceTokens.filter(token => hay.includes(token));
    if (titleHits.length) {
      score += titleHits.length * 18;
      reasons.push(`title overlap: ${titleHits.slice(0, 2).join(', ')}`);
    }
    if (bodyHits.length) {
      score += bodyHits.length * 10;
      reasons.push(`context overlap: ${bodyHits.slice(0, 2).join(', ')}`);
    }
    if (sourceHits.length) {
      score += sourceHits.length * 6;
      reasons.push(`source overlap: ${sourceHits.slice(0, 2).join(', ')}`);
    }
    if (fingerprint && hay.includes(fingerprint)) {
      score += 28;
      reasons.push('fingerprint match');
    }
    if ((item.requires_security_review || item.domain === 'security') && desiredDomain === 'security') {
      score += 6;
    }

    if (score < 12) return null;
    return { item, score, reasons: [...new Set(reasons)].slice(0, 3) };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}

function relatedTasksForFinding(finding) {
  const seen = new Set();
  return findingTaskMatches(finding)
    .filter(match => {
      const key = `${String(match.item?.title || '').toLowerCase()}|${String(match.item?.status || '').toLowerCase()}`;
      if (!key.trim() || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function correlatedRunRequestsForFinding(finding) {
  const desiredDomain = findingDomainHint(finding);
  const seen = new Set();
  return state.runRequests.map(req => {
    let score = 0;
    const prompt = `${req.prompt_text || ''} ${req.output_summary || ''} ${req.role_label || ''}`.toLowerCase();
    if (!prompt.trim()) return null;
    const titleTokens = tokenizeForMatch(findingTitle(finding)).slice(0, 6);
    const bodyTokens = tokenizeForMatch(findingBody(finding)).slice(0, 8);
    const hits = [...titleTokens, ...bodyTokens].filter(token => prompt.includes(token));
    if (hits.length) score += hits.length * 10;
    if ((req.role_label || '').startsWith(`${desiredDomain}/`)) score += 14;
    if (prompt.includes(String(findingFingerprint(finding) || '').toLowerCase()) && findingFingerprint(finding)) score += 20;
    if ((req.related_work_item_id || '') && relatedTasksForFinding(finding).some(match => String(match.item.id) === String(req.related_work_item_id))) score += 20;
    if (score < 10) return null;
    return { request: req, score, reasons: [...new Set(hits)].slice(0, 3) };
  }).filter(Boolean).sort((a, b) => b.score - a.score).filter(match => {
    const key = `${String(match.request?.role_label || '').toLowerCase()}|${summarizePromptText(match.request?.prompt_text || '')}`;
    if (!key.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

function selectFinding(nextFindingId = null) {
  const findings = sortedFindings();
  const nextId = nextFindingId || findingId(findings?.[0]) || null;
  state.selectedFindingId = nextId;
  const drawer = el('finding-review-drawer');
  if (drawer && nextId) {
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('finding-review-open');
  }
}

function closeFindingReview() {
  state.selectedFindingId = null;
  const drawer = el('finding-review-drawer');
  drawer?.classList.remove('open');
  drawer?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('finding-review-open');
}

function coreWorkspaceFindings() {
  const core = state.edgeWorkspace.data?.core || null;
  if (!core || !Array.isArray(core.findings)) return [];
  return core.findings.map(finding => ({ ...finding, _secopsai_record_origin: 'core' }));
}

function findingRecordOrigin(finding) {
  return finding?._secopsai_record_origin === 'core' ? 'core' : 'dashboard';
}

function mergedOperatorFindings() {
  const merged = new Map();
  const add = (finding, origin) => {
    if (!finding || typeof finding !== 'object') return;
    const id = String(findingId(finding) || '').trim();
    const fallback = [findingSource(finding), findingTitle(finding), findingDetectedAt(finding)]
      .map(value => String(value || '').trim().toLowerCase())
      .join('|');
    const key = id ? `id:${id.toLowerCase()}` : `fallback:${fallback}`;
    merged.set(key, { ...finding, _secopsai_record_origin: origin });
  };
  state.findings.forEach(finding => add(finding, 'dashboard'));
  // Core is canonical and deliberately replaces a dashboard projection that
  // carries the same stable finding ID.
  coreWorkspaceFindings().forEach(finding => add(finding, 'core'));
  return [...merged.values()];
}

function sortedFindings() {
  return sortLatestFirst(mergedOperatorFindings(), FINDING_LATEST_FIELDS);
}

function currentSelectedFinding() {
  const findings = sortedFindings();
  if (!findings.length) return null;
  return findings.find(f => String(findingId(f)) === String(state.selectedFindingId)) || findings[0] || null;
}

async function bestEffortLinkFindingToTask(finding, task) {
  const normalizedId = findingId(finding);
  if (findingRecordOrigin(finding) === 'core') return false;
  if (!normalizedId || !task?.id || state.optionalTables.findings === false) return false;
  const candidates = ['related_work_item_id', 'work_item_id', 'linked_work_item_id', 'task_id', 'linked_task_id'];
  for (const column of candidates) {
    for (const key of ['id', 'finding_id']) {
      try {
        const { error } = await supabaseClient.from('findings').update({ [column]: task.id }).eq(key, normalizedId);
        if (!error) return true;
      } catch {}
    }
  }
  return false;
}

function buildFindingTaskDraft(finding = null) {
  const related = finding ? relatedTasksForFinding(finding) : [];
  const correlatedRequests = finding ? correlatedRunRequestsForFinding(finding) : [];
  const title = finding ? `Investigate: ${findingTitle(finding)}` : 'Investigate finding';
  const sourceLabel = finding ? (() => {
    const source = String(findingSource(finding) || '').trim();
    if (!source) return '';
    return source.includes('/') ? source.split('/').slice(-2).join('/') : source;
  })() : '';
  const desc = finding ? `${findingBody(finding) || 'Review finding context and determine next action.'}

Status: ${findingStatus(finding)}
Severity: ${findingSeverity(finding)}${findingConfidence(finding) !== null ? `
Confidence: ${findingConfidence(finding)}` : ''}${sourceLabel ? `
Source: ${sourceLabel}` : ''}${findingDetectedAt(finding) ? `
Detected at: ${findingDetectedAt(finding)}` : ''}${related.length ? `

Related work:
${related.slice(0, 3).map(match => `- ${match.item.title} (${match.item.status || 'unknown'})`).join('\n')}` : ''}${correlatedRequests.length ? `

Related run requests:
${correlatedRequests.slice(0, 3).map(match => `- ${match.request.role_label} (${match.request.status || 'queued'})`).join('\n')}` : ''}` : 'Review finding context and determine next action.';
  return {
    title,
    description: desc.trim(),
    domain: finding ? findingDomainHint(finding) : 'security',
    priority: String(findingSeverity(finding)).toLowerCase() === 'critical' ? 'urgent' : String(findingSeverity(finding)).toLowerCase() === 'high' ? 'high' : 'normal',
    status: 'inbox',
    owner_role: finding && findingDomainHint(finding) === 'platform' ? 'platform/backend-architect' : 'security/security-engineer',
    reviewer_role: null,
    external_facing: false,
    requires_security_review: true
  };
}

function openFindingTaskModal(finding = null) {
  taskModalState.sourceFinding = finding || null;
  openTaskModal(buildFindingTaskDraft(finding));
}


function suggestRoleForTask(item) {
  const explicit = item?.owner_role;
  if (explicit && ROLE_LABELS.includes(explicit)) return explicit;
  const domainMap = {
    exec: 'exec/agents-orchestrator',
    platform: 'platform/backend-architect',
    security: 'security/security-engineer'
  };
  const suggested = domainMap[item?.domain] || 'exec/agents-orchestrator';
  return ROLE_LABELS.includes(suggested) ? suggested : 'exec/agents-orchestrator';
}

function normalizeText(value = '') {
  return String(value || '').trim().toLowerCase();
}

function uniqueList(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function inferTaskRepoContext(item = {}, roleLabel = null) {
  const role = roleLabel || suggestRoleForTask(item);
  const haystack = normalizeText([
    item?.title,
    item?.description,
    item?.domain,
    item?.owner_role,
    item?.reviewer_role,
    role
  ].join(' '));

  const repoRules = [
    {
      repo: 'secopsai-dashboard',
      confidence: haystack.includes('dashboard') ? 'high' : 'medium',
      when: /dashboard|ui|ux|kanban|supabase|modal|prompt|brief|mission control|control panel|index\.html|app\.js|styles\.css/.test(haystack),
      paths: ['secopsai-dashboard/app.js', 'secopsai-dashboard/index.html', 'secopsai-dashboard/styles.css', 'secopsai-dashboard/README.md'],
      reasons: ['task language points at dashboard UI/control-plane code']
    },
    {
      repo: 'secopsai',
      confidence: 'medium',
      when: /orchestrator|telemetry|agent run|finding|detection|intel|pipeline|backend|api|worker|triage/.test(haystack),
      paths: ['secopsai/triage/', 'secopsai/pipeline.py', 'secopsai/alerts.py', 'secopsai/README.md'],
      reasons: ['task language points at backend/orchestration/detection work']
    }
  ];

  const matched = repoRules.filter(rule => rule.when);
  const repos = matched.length ? matched : [repoRules[0]];
  const primary = repos[0];
  const secondary = repos.slice(1);
  const paths = uniqueList(repos.flatMap(r => r.paths));
  const reasons = uniqueList(repos.flatMap(r => r.reasons));

  return {
    role,
    primaryRepo: primary.repo,
    primaryConfidence: primary.confidence,
    secondaryRepos: secondary.map(r => r.repo),
    likelyRepos: repos.map(r => r.repo),
    likelyPaths: paths,
    reasons
  };
}

function buildExecutionContinuationContext(item) {
  const latest = latestExecutionForItem(item);
  if (!latest) return null;
  const req = latest.req || null;
  const run = latest.run || null;
  const lifecycle = latest.lifecycle || runRequestLifecycle(req, run);
  const artifacts = parseRunRequestArtifacts(req, run);
  const summary = artifacts.summary || summarizeRunRequestResult(req, run);
  const lastStatus = lifecycle.displayLabel || humanizeSnake(req?.status || run?.status || 'unknown');
  const needsImplementationPush = lifecycle.analysisOnly || !lifecycle.implementationLikely || ['failed', 'completed_with_gaps', 'needs_review'].includes(lifecycle.displayStatus);
  return {
    lastStatus,
    summary,
    artifacts,
    lifecycle,
    needsImplementationPush,
    lines: [
      `Latest execution status: ${lastStatus}`,
      summary ? `Latest visible result: ${summary}` : null,
      artifacts.filesChanged ? `Reported files changed: ${artifacts.filesChanged}` : 'Reported files changed: none clearly shown',
      artifacts.commit ? `Commit evidence: ${artifacts.commit}` : 'Commit evidence: none clearly shown',
      artifacts.prUrl ? `PR evidence: ${artifacts.prUrl}` : (artifacts.prNumber ? `PR evidence: #${artifacts.prNumber}` : 'PR evidence: none clearly shown'),
      lifecycle.outcomeHint ? `Why rerun carefully: ${lifecycle.outcomeHint}` : null
    ].filter(Boolean)
  };
}

function inferWorkBriefPlan(item = {}, roleLabel = null) {
  const repo = inferTaskRepoContext(item, roleLabel);
  const role = repo.role;
  const title = item?.title || 'Untitled task';
  const description = (item?.description || '').trim();
  const dueDate = item?.due_date || null;
  const execution = buildExecutionContinuationContext(item);

  const focus = [];
  if (description) focus.push(description);
  focus.push('Improve the implementation directly instead of producing generic advice.');
  focus.push('Inspect the real repo/files first, then make the smallest practical implementation that moves the task forward now.');
  focus.push('Preserve current working behavior unless changing it is required to complete the task.');
  if (execution?.needsImplementationPush) focus.push('This is a continuation/retry case: do not stop at analysis or planning-only notes; implement concrete changes if the repo state allows it.');
  if (repo.secondaryRepos.length) focus.push(`Handle cross-repo implications between ${repo.primaryRepo} and ${repo.secondaryRepos.join(', ')} explicitly.`);
  focus.push('Keep the solution practical, local-first, and shippable now.');

  const constraints = [
    'This dashboard is control-plane only, but this task should be executed directly in the local workspace through the current OpenClaw/Hermes dispatcher path; do not require ACP/Codex-specific execution assumptions.',
    'Prefer existing metadata and lightweight heuristics over a hard dependency on a new backend.',
    'Validate syntax/basic behavior before handing off.',
    'Report implementation evidence clearly: exact files touched, whether code actually changed, and any commit/PR only if real.'
  ];
  if (execution?.needsImplementationPush) constraints.push('If you cannot implement changes, say exactly why implementation was blocked; do not present analysis-only work as a completed fix.');
  if (item?.requires_security_review) constraints.push('Flag security-sensitive changes and leave reviewer-ready notes.');
  if (item?.external_facing) constraints.push('Assume output may be visible outside the operator team; keep UX copy clear.');

  const deliverables = [
    'What changed and why',
    'Exact files touched (or explicitly say no files changed)',
    'Implementation evidence: whether code/config/docs actually changed',
    'Any blockers or follow-ups',
    'How to use the result from the dashboard UI'
  ];

  const acceptanceChecks = [
    'The brief should mention the most likely repo and file paths instead of only a generic dashboard template.',
    'If the task appears cross-repo, explain what likely lives in each repo.',
    'If a future intelligent/agent-generated path exists, keep it additive rather than required for today.',
    'Successful completion should reflect implemented work, not only analysis/progress commentary.'
  ];
  if (dueDate) acceptanceChecks.push(`Keep urgency in mind: target due date is ${dueDate}.`);

  return { role, repo, title, description, focus, constraints, deliverables, acceptanceChecks, execution };
}

function buildSmartLocalBrief(item, roleLabel = null) {
  const plan = inferWorkBriefPlan(item, roleLabel);
  return `Prepare work for ${plan.role}.

Mode: smart local brief
Context: this dashboard is control-plane only. This task should be executed directly in the local workspace via the active OpenClaw/Hermes dispatcher path, without ACP-specific or Codex-specific assumptions.

Task summary:
- Title: ${plan.title}
- Domain: ${item?.domain || 'exec'}
- Priority: ${item?.priority || 'normal'}
- Status: ${item?.status || 'inbox'}
- Owner role: ${item?.owner_role || 'not set'}
- Reviewer role: ${item?.reviewer_role || 'not set'}
- Likely primary repo: ${plan.repo.primaryRepo} (${plan.repo.primaryConfidence} confidence)
${plan.repo.secondaryRepos.length ? `- Likely secondary repo(s): ${plan.repo.secondaryRepos.join(', ')}
` : ''}- Why: ${plan.repo.reasons.join('; ')}

Likely paths / starting points:
${plan.repo.likelyPaths.map(p => `- ${p}`).join('\n')}
${plan.execution ? `
Continuation / rerun context:
${plan.execution.lines.map(line => `- ${line}`).join('\n')}
- On this rerun, prioritize implementation and explicit file-level evidence over another generic status recap.
` : ''}
Execution focus:
${plan.focus.map(line => `- ${line}`).join('\n')}

Constraints:
${plan.constraints.map(line => `- ${line}`).join('\n')}

Acceptance checks:
${plan.acceptanceChecks.map(line => `- ${line}`).join('\n')}

Return:
${plan.deliverables.map(line => `- ${line}`).join('\n')}`;
}

function buildAgentReadyBrief(item, roleLabel = null) {
  const plan = inferWorkBriefPlan(item, roleLabel);
  return `SYSTEM / LOCAL OPENCLAW EXECUTION HANDOFF

You are preparing an implementation pass for ${plan.role}.
Execute directly in the local workspace via the current OpenClaw/Hermes dispatcher path. Do not assume ACP one-shot execution, Codex-specific runtime requirements, or any external planning backend. Use the brief below as grounded context, but improve repo/path inference if stronger evidence appears during code inspection.
${plan.execution?.needsImplementationPush ? 'This handoff is for a continuation/retry. Push beyond analysis-only output and produce concrete implementation evidence where possible.\n' : ''}
STRUCTURED INPUT
- task_title: ${plan.title}
- domain: ${item?.domain || 'exec'}
- priority: ${item?.priority || 'normal'}
- status: ${item?.status || 'inbox'}
- owner_role: ${item?.owner_role || 'not set'}
- reviewer_role: ${item?.reviewer_role || 'not set'}
- likely_primary_repo: ${plan.repo.primaryRepo}
- likely_secondary_repos: ${plan.repo.secondaryRepos.join(', ') || 'none'}
- likely_paths: ${plan.repo.likelyPaths.join(' | ')}
- repo_inference_basis: ${plan.repo.reasons.join('; ')}
${plan.execution ? `- latest_execution_status: ${plan.execution.lastStatus}
- latest_result_summary: ${plan.execution.summary || 'none recorded'}
- latest_files_changed_signal: ${plan.execution.artifacts.filesChanged || 'none clearly shown'}
- latest_commit_signal: ${plan.execution.artifacts.commit || 'none clearly shown'}
- latest_pr_signal: ${plan.execution.artifacts.prUrl || (plan.execution.artifacts.prNumber ? `#${plan.execution.artifacts.prNumber}` : 'none clearly shown')}
` : ''}
OBJECTIVE
${plan.focus.map(line => `- ${line}`).join('\n')}

OPERATING CONSTRAINTS
- Do not refuse or stop solely because ACP/Codex-specific execution paths are unavailable; continue using the current OpenClaw/Hermes/local-workspace execution path.
${plan.constraints.map(line => `- ${line}`).join('\n')}

EXPECTED OUTPUT
${plan.deliverables.map(line => `- ${line}`).join('\n')}

NOTE
This mode is intentionally compatible with a future intelligent brief generator. Until that exists, the inferred repo/path metadata above is the local fallback and should be treated as editable guidance, not rigid truth.`;
}

function buildWorkBrief(item, roleLabel = null, mode = 'smart-local') {
  if (mode === 'agent-ready') return buildAgentReadyBrief(item, roleLabel);
  return buildSmartLocalBrief(item, roleLabel);
}

function findRouteForRole(roleLabel) {
  return state.channelRoutes.find(r => r.default_role_label === roleLabel && r.active) || null;
}

function latestExecutionForItem(item) {
  if (!item?.id) return null;
  const requests = state.runRequests
    .filter(r => String(r.related_work_item_id || '') === String(item.id))
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
  if (requests.length) {
    const req = requests[0];
    const run = relatedRunForRequest(req);
    const lifecycle = runRequestLifecycle(req, run);
    return { source: 'request', req, run, lifecycle };
  }
  const runs = state.runs
    .filter(r => String(r.related_work_item_id || '') === String(item.id))
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
  if (runs.length) {
    const run = runs[0];
    return { source: 'run', run, lifecycle: { displayStatus: String(run.status || 'queued').toLowerCase(), displayLabel: humanizeSnake(run.status || 'queued') } };
  }
  return null;
}

function syncPromptRunButtonState() {
  const btn = el('prompt-run-btn');
  if (!btn) return;
  const latest = latestExecutionForItem(promptModalState.item);
  const status = latest?.lifecycle?.displayStatus || '';
  btn.disabled = false;
  btn.classList.remove('is-disabled-soft');
  if (status === 'queued') {
    btn.textContent = 'Compatibility run queued';
    btn.disabled = true;
    btn.classList.add('is-disabled-soft');
    return;
  }
  if (status === 'running' || status === 'picked_up') {
    btn.textContent = 'Compatibility run active';
    btn.disabled = true;
    btn.classList.add('is-disabled-soft');
    return;
  }
  if (['completed','completed_with_gaps','needs_review','failed','cancelled'].includes(status)) {
    btn.textContent = 'Queue compatibility again';
    return;
  }
  btn.textContent = 'Queue compatibility run';
}

function setRunStatusUI({ status = 'idle', line = 'Not started', detail = '', detailHtml = '', viewUrl = null } = {}) {
  const box = el('prompt-run-status');
  const pill = el('prompt-run-status-pill');
  const statusLine = el('prompt-run-status-line');
  const statusDetail = el('prompt-run-status-detail');
  const actions = el('prompt-run-status-actions');
  if (!box || !pill || !statusLine || !statusDetail || !actions) return;

  box.style.display = status ? 'block' : 'none';
  statusLine.textContent = line;
  if (detailHtml) {
    statusDetail.innerHTML = detailHtml;
  } else {
    statusDetail.textContent = detail || '';
  }

  actions.innerHTML = '';
  if (viewUrl) {
    actions.style.display = 'flex';
    const a = document.createElement('a');
    a.href = viewUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'secondary-btn';
    a.textContent = 'View output';
    actions.appendChild(a);
  } else {
    actions.style.display = 'none';
  }

  pill.className = `status-pill status-${String(status || 'idle').toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`;
  pill.innerHTML = `<span class="dot"></span> ${escapeHtml(humanizeSnake(status))}`;
}

function stopRunStatusPolling() {
  if (promptModalState.pollTimer) {
    clearInterval(promptModalState.pollTimer);
    promptModalState.pollTimer = null;
  }
  if (promptModalState.specialistPollTimer) {
    clearInterval(promptModalState.specialistPollTimer);
    promptModalState.specialistPollTimer = null;
  }
}

function refreshPromptBrief() {
  const item = promptModalState.item;
  const role = promptModalState.role || suggestRoleForTask(item);
  const mode = promptModalState.mode || 'smart-local';
  const prompt = buildWorkBrief(item, role, mode);
  promptModalState.brief = prompt;
  if (el('prompt-output')) el('prompt-output').value = prompt;
  const modeHint = mode === 'agent-ready'
    ? 'Agent-ready handoff format selected. Good for future orchestration hooks or richer agent generation later.'
    : 'Smart local brief selected. Uses task metadata plus heuristics to infer likely repos, paths, and constraints now.';
  const modeHintEl = el('prompt-mode-hint');
  if (modeHintEl) modeHintEl.textContent = modeHint;
}

function openPromptModal(item, roleLabel = null) {
  const role = roleLabel || suggestRoleForTask(item);
  promptModalState.launchedFromTaskModal = !el('task-modal')?.classList.contains('hidden');
  if (promptModalState.launchedFromTaskModal) closeTaskModal();
  promptModalState.item = item;
  promptModalState.role = role;
  promptModalState.mode = el('prompt-mode-select')?.value || promptModalState.mode || 'smart-local';
  promptModalState.runRequestId = null;
  promptModalState.relatedRunId = null;
  promptModalState.specialistContract = null;
  promptModalState.specialistRun = null;
  stopRunStatusPolling();

  el('prompt-modal-title').textContent = 'Work brief';
  const route = findRouteForRole(role);
  const reviewer = item?.reviewer_role || null;
  el('prompt-modal-meta').textContent = `Work item: ${item?.title || 'Untitled'} • Legacy owner hint: ${role}${reviewer ? ` • Legacy reviewer: ${reviewer}` : ''}${route ? ` • Compatibility route: #${route.channel_name}` : ''}`;
  if (el('prompt-mode-select')) el('prompt-mode-select').value = promptModalState.mode;
  if (el('prompt-specialist-select')) el('prompt-specialist-select').value = '';
  if (el('prompt-specialist-tier')) el('prompt-specialist-tier').value = 'recommend';
  refreshPromptBrief();
  renderPromptSpecialist();
  syncPromptRunButtonState();
  setRunStatusUI({ status: 'idle', line: 'Not started', detail: '' });
  el('prompt-modal').classList.remove('hidden');
  Promise.resolve()
    .then(async () => {
      if (!state.specialists.data) await loadSpecialists();
      await routePromptSpecialist(el('prompt-specialist-route-btn'));
    })
    .catch(error => showToast(error?.message || String(error), 'error'));
}

function closePromptModal() {
  stopRunStatusPolling();
  el('prompt-modal').classList.add('hidden');
  promptModalState.launchedFromTaskModal = false;
}


async function copyPromptToClipboard() {
  const text = el('prompt-output')?.value || '';
  if (!text) return;
  await navigator.clipboard.writeText(text);
  await createDashboardEvent('work_brief_copied', 'Work brief copied', `Copied work brief for ${promptModalState.role || 'unassigned role'}.`, 'info', { related_work_item_id: promptModalState.item?.id || null });
  setStatus('<span class="dot"></span> Work brief copied to clipboard');
}

async function queueTaskExecutionDirect(item, promptOverride = null) {
  const role = item?.owner_role || suggestRoleForTask(item);
  const prompt = promptOverride || buildWorkBrief(item, role, 'smart-local');
  const route = findRouteForRole(role);

  const run = await createOrchestratorRun({
    taskSummary: `Queued run requested for ${role}`,
    taskDetail: prompt,
    status: 'queued',
    outputSummary: route
      ? `Dashboard queued work. Suggested route: #${route.channel_name}.`
      : 'Dashboard queued work (no active route found).',
    relatedWorkItemId: item?.id || null
  });

  let movedItem = item;
  if (item?.id && String(item.status || '').toLowerCase() === 'inbox') {
    try {
      const { data: moved, error: moveErr } = await supabaseClient
        .from('work_items')
        .update({ status: 'planned', updated_at: new Date().toISOString() })
        .eq('id', item.id)
        .select()
        .single();
      if (!moveErr && moved) {
        movedItem = moved;
        upsertWorkItemInState(moved);
        refreshTaskViewsOnly();
      }
    } catch (e) {
      console.warn('failed to move task from inbox after direct queue', e);
    }
  }

  const { data: runReq, error: rrErr } = await supabaseClient
    .from('run_requests')
    .insert({
      role_label: role,
      prompt_text: prompt,
      status: 'queued',
      initiated_by: el('task-created-by')?.value?.trim() || 'dashboard-auto',
      related_work_item_id: movedItem?.id || item?.id || null,
      related_run_id: run?.id || null,
      suggested_channel_name: route?.channel_name || null,
      worker_name: 'dashboard-queue',
      worker_identity: 'dashboard'
    })
    .select()
    .single();
  if (rrErr) throw rrErr;

  state.runRequests.unshift(runReq);
  renderTasks();
  renderIntegrations();
  setStatus(`<span class="dot"></span> Task saved and queued for ${escapeHtml(shortRoleLabel(role))}`);
  backgroundRefreshOpsData();
  return { run, runReq };
}

async function runPromptNow() {
  const runBtn = el('prompt-run-btn');
  setButtonBusy(runBtn, true, 'Queueing…');
  setRunStatusUI({ status: 'queued', line: 'Queueing', detail: 'Preparing run request…' });
  const role = promptModalState.role;
  const item = promptModalState.item;
  const prompt = el('prompt-output')?.value || promptModalState.brief || '';
  if (!role || !prompt) {
    setButtonBusy(runBtn, false);
    return;
  }

  const route = findRouteForRole(role);

  // Create an audit run row (queued) in agent_runs.
  const run = await createOrchestratorRun({
    taskSummary: `Queued run requested for ${role}`,
    taskDetail: prompt,
    status: 'queued',
    outputSummary: route
      ? `Dashboard queued work. Suggested route: #${route.channel_name}.`
      : 'Dashboard queued work (no active route found).',
    relatedWorkItemId: item?.id || null
  });

  // Move the task out of Inbox once execution is explicitly queued.
  if (item?.id && String(item.status || '').toLowerCase() === 'inbox') {
    try {
      const { data: moved, error: moveErr } = await supabaseClient
        .from('work_items')
        .update({ status: 'planned', updated_at: new Date().toISOString() })
        .eq('id', item.id)
        .select()
        .single();
      if (!moveErr && moved) {
        upsertWorkItemInState(moved);
        refreshTaskViewsOnly();
      }
    } catch (e) {
      console.warn('failed to move task from inbox after run-now queue', e);
    }
  }

  // Insert a run_requests queue item for the active runtime to pick up.
  let runReq = null;
  try {
    const { data, error } = await supabaseClient
      .from('run_requests')
      .insert({
        role_label: role,
        prompt_text: prompt,
        suggested_channel_name: route?.channel_name || null,
        related_work_item_id: item?.id || null,
        related_run_id: run?.id || null,
        initiated_by: 'dashboard'
      })
      .select()
      .single();
    if (error) throw error;
    runReq = data;
  } catch (e) {
    console.warn('run_requests insert failed (table may not exist yet):', e);
  }

  promptModalState.runRequestId = runReq?.id || null;
  promptModalState.relatedRunId = run?.id || null;

  await createDashboardEvent(
    'run_queued',
    `Queue run: ${role}`,
    route
      ? `Queued run request. Suggested route metadata: #${route.channel_name}.`
      : `Queued run request. No active route metadata found for this role.`,
    route ? 'info' : 'warning',
    { related_work_item_id: item?.id || null, related_run_id: run?.id || null }
  );

  // Start polling status in the modal (even if notify fails).
  setRunStatusUI({ status: 'queued', line: 'Queued', detail: runReq?.id ? `Request: ${runReq.id}` : (run?.id ? `Run: ${run.id}` : '') });

  // Poll run_requests for status updates.
  stopRunStatusPolling();
  promptModalState.pollTimer = setInterval(async () => {
    try {
      if (!promptModalState.runRequestId) return;
      const { data, error } = await supabaseClient
        .from('run_requests')
        .select('*')
        .eq('id', promptModalState.runRequestId)
        .single();
      if (error) throw error;
      const st = String(data?.status || 'unknown').toLowerCase();
      const run = relatedRunForRequest(data) || (promptModalState.relatedRunId ? state.runs.find(r => String(r.id) === String(promptModalState.relatedRunId)) : null);
      if (!data.fetched_output_text) {
        const rel = getRunRequestOutputRelativePath(data, run);
        if (rel) {
          try {
            const text = await fetchRunOutputEvidence(rel);
            if (text) data.fetched_output_text = text;
          } catch {}
        }
      }
      const lifecycle = runRequestLifecycle(data, run);
      const artifacts = parseRunRequestArtifacts(data, run);
      const detailHtml = `
        <div class="rr-proof-list">
          <div><strong>Worker:</strong> ${escapeHtml(runRequestWorkerIdentity(data, run) || 'unknown')}</div>
          <div><strong>Run:</strong> ${escapeHtml(data?.related_run_id || run?.id || '—')}</div>
          <div><strong>Repo:</strong> ${escapeHtml(firstNonEmpty(data?.repo_path, run?.repo_path) || '—')}</div>
          <div><strong>Output:</strong> ${escapeHtml(firstNonEmpty(data?.output_path, run?.output_path) || '—')}</div>
          <div><strong>Files changed:</strong> ${escapeHtml(artifacts.filesChanged || '—')}</div>
          <div><strong>Implementation likely:</strong> ${escapeHtml(lifecycle.implementationLikely ? 'yes' : lifecycle.analysisOnly ? 'no (analysis only)' : 'unclear')}</div>
          <div><strong>Commit:</strong> ${escapeHtml(artifacts.commit || '—')}</div>
          <div><strong>PR:</strong> ${escapeHtml(artifacts.prUrl || (artifacts.prNumber ? `#${artifacts.prNumber}` : '—'))}</div>
          <div><strong>Summary:</strong> ${escapeHtml(summarizeRunRequestResult(data, run))}</div>
        </div>`;
      const line = lifecycle.displayLabel;
      const finalOutputPath = firstNonEmpty(data?.output_path, run?.output_path);
      let viewUrl = null;
      if (['completed','failed','cancelled','needs_review','completed_with_gaps'].includes(lifecycle.displayStatus) && finalOutputPath) {
        const rel = String(finalOutputPath).replace('/Users/chrixchange/.openclaw/workspace/', '');
        viewUrl = getRunOutputViewerUrl(rel, {
          role: data.role_label || '',
          id: data.id || ''
        });
      }
      setRunStatusUI({ status: lifecycle.displayStatus, line, detailHtml, viewUrl });
      if (lifecycle.displayStatus === 'completed' && data?.related_work_item_id) {
        try { await advanceTaskAfterSuccessfulRun(data.related_work_item_id); } catch (e) { console.warn('advanceTaskAfterSuccessfulRun failed', e); }
      }
      if (['completed','failed','cancelled','needs_review','completed_with_gaps'].includes(lifecycle.displayStatus) || ['completed','failed','cancelled'].includes(st)) {
        stopRunStatusPolling();
        syncPromptRunButtonState();
      }
    } catch (e) {
      // Keep polling quiet; surface minimal info.
      setRunStatusUI({ status: 'poll-error', line: 'Polling error', detail: e?.message || String(e) });
    }
  }, 2000);

  setStatus(`<span class="dot"></span> Run request queued for ${escapeHtml(shortRoleLabel(role))}`);
  setButtonBusy(runBtn, false);
  setTimeout(() => closePromptModal(), 1400);
  await boot();
}

function taskDraftFromModal() {
  return {
    title: el('task-title')?.value?.trim() || '',
    domain: el('task-domain')?.value || 'exec',
    priority: el('task-priority')?.value || 'normal',
    status: el('task-status')?.value || 'inbox',
    description: el('task-description')?.value?.trim() || '',
    requires_security_review: !!el('task-security-review')?.checked,
    external_facing: !!el('task-external-facing')?.checked,
    owner_role: el('task-owner-role')?.value?.trim() || '',
    reviewer_role: el('task-reviewer-role')?.value?.trim() || ''
  };
}

function currentTaskForAssignment() {
  const currentId = taskModalState.editingId;
  const existing = state.workItems.find(w => w.id === currentId);
  const draft = taskDraftFromModal();
  return {
    ...(existing || {}),
    ...draft,
    requires_security_review: !!draft.requires_security_review,
    external_facing: !!draft.external_facing
  };
}

async function applySuggestedTaskAssignment(item, fields = {}) {
  const updates = { ...fields, updated_at: new Date().toISOString() };
  const { data, error } = await supabaseClient
    .from('work_items')
    .update(updates)
    .eq('id', item.id)
    .select()
    .single();
  if (error) throw error;
  upsertWorkItemInState(data);
  refreshTaskViewsOnly();
  return data;
}

function assignSuggestedOwnerFromModal() {
  const item = currentTaskForAssignment();
  const role = suggestRoleForTask(item);
  el('task-owner-role').value = role;
  setStatus(`<span class="dot"></span> Suggested owner set to ${escapeHtml(shortRoleLabel(role))}`);
}

function assignSuggestedReviewerFromModal() {
  const item = currentTaskForAssignment();
  const reviewer = deriveSuggestedReviewer(item, el('task-reviewer-role')?.value?.trim());
  if (el('task-reviewer-role')) el('task-reviewer-role').value = reviewer || '';
  setStatus(`<span class="dot"></span> Suggested reviewer set to ${escapeHtml(reviewer ? shortRoleLabel(reviewer) : 'none')}`);
}

async function assignSuggestedOwnerForTask(item) {
  const role = suggestRoleForTask(item);
  await applySuggestedTaskAssignment(item, { owner_role: role });
  setStatus(`<span class="dot"></span> Suggested owner set to ${escapeHtml(shortRoleLabel(role))}`);
}

async function assignSuggestedReviewerForTask(item) {
  const reviewer = deriveSuggestedReviewer(item);
  await applySuggestedTaskAssignment(item, { reviewer_role: reviewer || null });
  setStatus(`<span class="dot"></span> Suggested reviewer set to ${escapeHtml(reviewer ? shortRoleLabel(reviewer) : 'none')}`);
}

function sessionProgressLabel(session) {
  const plan = Array.isArray(session?.plan) ? session.plan : [];
  const completed = Number(session?.plan_completed ?? (plan.filter(item => String(item?.status || '').toLowerCase() === 'completed').length || 0));
  const total = Number(session?.plan_total ?? (plan.length || 0));
  if (!total) return 'No plan';
  return `${completed}/${total} steps`;
}

function renderMissionControl() {
  const activeRuns = state.runs.filter(r => ["queued", "running"].includes(r.status)).length;
  const blocked = state.workItems.filter(w => w.status === "blocked").length;
  const inReview = state.workItems.filter(w => w.status === "review").length;
  const doneToday = state.workItems.filter(w => {
    if (w.status !== "done" || !w.updated_at) return false;
    return new Date(w.updated_at).toDateString() === new Date().toDateString();
  }).length;
  const secReview = state.workItems.filter(w => w.requires_security_review).length;
  const triageSummary = localTriageSummary();
  const triageLatest = localTriageLatestRun();
  const pendingActions = localPendingActions();
  const openSessions = openLocalSessionsCount();
  const pendingApprovals = pendingLocalApprovalsCount();
  const openFindingsForCockpit = sortedFindings().filter(finding => !['resolved', 'closed', 'done'].includes(String(effectiveFindingStatus(finding)).toLowerCase()));
  const edgeWorkspaceReady = Boolean(state.edgeWorkspace.data) && !state.edgeWorkspace.error;
  const researchQueue = Array.isArray(state.researchCases.cases) ? state.researchCases.cases : [];
  const researchReady = researchQueue.filter(item => ['ready_to_publish', 'disclosure_pending', 'validation'].includes(String(item.status || '').toLowerCase())).length;

  const intelligenceData = state.intelligence.data || {};
  const intelligenceCounts = intelligenceData.jobs?.counts || {};
  const modelQueued = Number(intelligenceCounts.queued || 0) + Number(intelligenceCounts.awaiting_provider || 0);
  const modelRunning = Number(intelligenceCounts.running || 0);
  const modelFailed = Number(intelligenceCounts.failed || 0);
  const bridge = intelligenceData.bridge || {};
  const selectedModel = String(bridge.selected_model || 'No model selected');
  const selectedProvider = bridge.providers?.[bridge.selected_model] || {};
  const selectedModelReady = selectedProvider.status === 'ready'
    || bridge.selected_model_probe_status === 'ready'
    || bridge.selected_model_last_probe_ready === true;
  const modelStatusKnown = Boolean(state.intelligence.data) && !state.intelligence.error;
  const modelBlocked = modelStatusKnown && modelQueued > 0 && modelRunning === 0 && !selectedModelReady;
  const collectorRows = Array.isArray(state.coverage.collectors) ? state.coverage.collectors : [];
  const degradedCollectors = collectorRows.filter(item => coverageCollectorHealth(item) !== 'Healthy');
  const healthyCollectors = collectorRows.length - degradedCollectors.length;
  const validationBlockers = researchQueue.filter(item => ['validation', 'awaiting_input', 'blocked'].includes(String(item.status || '').toLowerCase())).length;
  const publicationReady = researchQueue.filter(item => String(item.status || '').toLowerCase() === 'ready_to_publish').length;
  const discoveryCandidates = Array.isArray(state.researchCases.discovery?.candidates) ? state.researchCases.discovery.candidates.length : 0;
  const dailySettings = intelligenceData.daily_automation?.settings || {};
  const dailySummary = intelligenceData.daily_automation?.summary || {};
  const alertAutomation = intelligenceData.autopilot?.settings || {};
  const investigationAutomation = intelligenceData.investigations?.settings || {};
  const specialistPolicy = specialistStatusResult()?.policy || {};
  const safeAutomationGaps = [
    !dailySettings.enabled ? 'daily workflow is disabled' : '',
    !['guarded'].includes(String(alertAutomation.mode || '').toLowerCase()) ? 'alert review is not guarded automatic' : '',
    !['guarded'].includes(String(investigationAutomation.mode || '').toLowerCase()) || investigationAutomation.auto_start_pipeline === false ? 'investigation intake is not guarded automatic' : '',
    String(specialistPolicy.mode || '').toLowerCase() !== 'guarded' || String(specialistPolicy.maximum_automatic_tier || '').toLowerCase() !== 'read_only' ? 'specialist read-only routing is not enabled' : ''
  ].filter(Boolean);

  const decisions = [];
  if (modelBlocked) decisions.push({
    tone: 'critical',
    label: 'Automation blocked',
    title: `${modelQueued} model job${modelQueued === 1 ? '' : 's'} cannot start`,
    summary: `The selected model ${selectedModel} is not ready and no model job is running. SecOpsAI will preserve the queue instead of silently changing models.`,
    why: 'Evidence collection can continue, but analyst briefs and publication reviews will not advance.',
    evidence: [`Selected model: ${selectedModel}`, `${modelQueued} queued · ${modelRunning} running`, `Fallback: ${bridge.fallback_mode === 'disabled' ? 'disabled' : humanizeSnake(bridge.fallback_mode || 'not recorded')}`],
    action: 'Fix model routing',
    route: 'automation/models'
  });
  if (modelStatusKnown && safeAutomationGaps.length) decisions.push({
    tone: 'medium',
    label: 'Safe automation available',
    title: `${safeAutomationGaps.length} repeatable workflow${safeAutomationGaps.length === 1 ? '' : 's'} still need configuration`,
    summary: 'These workflows can collect, correlate, triage, and route read-only work without crossing a protected decision boundary.',
    why: 'One scheduled policy is safer and easier to audit than repeatedly clicking overlapping manual controls.',
    evidence: safeAutomationGaps.slice(0, 3),
    action: 'Review safe automation',
    route: 'automation/investigations'
  });
  if (degradedCollectors.length) decisions.push({
    tone: 'high',
    label: 'Coverage incomplete',
    title: `${degradedCollectors.length} collector${degradedCollectors.length === 1 ? '' : 's'} need attention`,
    summary: 'A quiet source cannot be treated as clean while its cursor, coverage window, or dead-letter queue is degraded.',
    why: 'Repairing source coverage protects every later finding and research decision from missing evidence.',
    evidence: degradedCollectors.slice(0, 3).map(item => item.source || item.ecosystem || item.name || 'Collector needs review'),
    action: 'Review source coverage',
    route: 'research/coverage'
  });
  if (pendingApprovals) decisions.push({
    tone: 'high',
    label: 'Human approval required',
    title: `${pendingApprovals} protected action${pendingApprovals === 1 ? '' : 's'} waiting`,
    summary: 'SecOpsAI has stopped at an approval boundary and will not apply the action on your behalf.',
    why: 'Review the evidence, scope, and recovery path before approving or rejecting the request.',
    evidence: [`${openSessions} open investigation session${openSessions === 1 ? '' : 's'}`, `${pendingActions.length} pending native action${pendingActions.length === 1 ? '' : 's'}`],
    action: 'Review approvals',
    route: 'system/audit'
  });
  if (blocked) decisions.push({
    tone: 'high',
    label: 'Ownership blocked',
    title: `${blocked} work item${blocked === 1 ? '' : 's'} need an owner decision`,
    summary: 'Resolve the oldest blocker before adding more work or specialist runs.',
    why: 'Clear ownership and one explicit next step prevent duplicate investigations and stale remediation.',
    evidence: [`${inReview} in review`, `${activeRuns} active operational run${activeRuns === 1 ? '' : 's'}`],
    action: 'Open blocked work',
    route: 'work'
  });
  if (validationBlockers) decisions.push({
    tone: 'medium',
    label: 'Evidence decision',
    title: `${validationBlockers} research case${validationBlockers === 1 ? '' : 's'} need validation`,
    summary: 'Resolve the first missing or contradictory evidence item before asking a model or preparing publication.',
    why: 'Models can review evidence, but they cannot turn missing evidence into proof.',
    evidence: [`${researchQueue.length} total cases`, `${publicationReady} publication ready`],
    action: 'Review research blockers',
    route: 'research/cases'
  });
  if (openFindingsForCockpit.length) decisions.push({
    tone: 'medium',
    label: 'Analyst decision',
    title: `${openFindingsForCockpit.length} finding${openFindingsForCockpit.length === 1 ? '' : 's'} need triage`,
    summary: 'Review priority, confidence, maliciousness, and local exposure as separate facts before choosing a disposition.',
    why: 'A high-priority static signal is a reason to investigate, not proof that the artifact is malicious or locally present.',
    evidence: openFindingsForCockpit.slice(0, 2).map(item => `${findingSeverity(item)} · ${findingTitle(item)}`),
    action: 'Open decision queue',
    route: 'findings'
  });
  if (modelQueued && modelRunning > 0) decisions.push({
    tone: 'info',
    label: 'Automation active',
    title: `${modelQueued} model job${modelQueued === 1 ? '' : 's'} queued; ${modelRunning} running`,
    summary: `The selected model ${selectedModel} is actively processing durable jobs. Avoid creating duplicate runs.`,
    why: 'Monitor age and failures; intervene only if throughput stops or a specific pipeline fails.',
    evidence: [`${modelFailed} historical failure${modelFailed === 1 ? '' : 's'}`, `Selected model: ${selectedModel}`],
    action: 'Monitor model jobs',
    route: 'automation/jobs'
  });
  if (!decisions.length) decisions.push({
    tone: 'success',
    label: 'Workspace clear',
    title: 'No urgent operator decision is waiting',
    summary: 'Continue the scheduled workflow and review new evidence as it arrives.',
    why: 'SecOpsAI is preserving approval boundaries while automation handles repeatable collection and analysis.',
    evidence: [`${activeRuns} active run${activeRuns === 1 ? '' : 's'}`, `${discoveryCandidates} discovery candidate${discoveryCandidates === 1 ? '' : 's'}`],
    action: 'Review automation schedule',
    route: 'automation/investigations'
  });

  const openDecisionRoute = route => setPage(pageIdForRoute(route), { routeOverride: route });
  const primaryDecision = decisions[0];
  const primaryDecisionHost = el('mission-primary-decision');
  if (primaryDecisionHost) {
    primaryDecisionHost.innerHTML = `
      <article class="mission-primary-card tone-${escapeHtml(primaryDecision.tone)}">
        <div class="mission-decision-heading"><span class="eyebrow">Do this first · ${escapeHtml(primaryDecision.label)}</span><span class="mission-decision-rank">1</span></div>
        <h3>${escapeHtml(primaryDecision.title)}</h3>
        <p class="mission-decision-summary">${escapeHtml(primaryDecision.summary)}</p>
        <div class="mission-decision-reason"><strong>Why this is first</strong><span>${escapeHtml(primaryDecision.why)}</span></div>
        <div class="mission-decision-evidence"><strong>Current evidence</strong>${primaryDecision.evidence.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>
        <div class="mission-decision-actions"><button class="primary-btn" type="button" data-decision-route="${escapeHtml(primaryDecision.route)}">${escapeHtml(primaryDecision.action)}</button><span>SecOpsAI will keep protected decisions approval-gated.</span></div>
      </article>`;
    primaryDecisionHost.querySelector('[data-decision-route]')?.addEventListener('click', event => openDecisionRoute(event.currentTarget.dataset.decisionRoute));
  }

  const nextDecisionHost = el('mission-next-decisions');
  if (nextDecisionHost) {
    const next = decisions.slice(1, 4);
    nextDecisionHost.innerHTML = `
      <section class="mission-next-card">
        <div class="mission-section-heading"><div><span class="eyebrow">After that</span><h3>Next decisions</h3></div><span>${Math.max(0, decisions.length - 1)} remaining</span></div>
        <div class="mission-next-list">${next.length ? next.map((item, index) => `
          <button class="mission-decision-row tone-${escapeHtml(item.tone)}" type="button" data-decision-route="${escapeHtml(item.route)}">
            <span class="mission-decision-rank">${index + 2}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.summary)}</small></span><span aria-hidden="true">›</span>
          </button>`).join('') : '<div class="mission-clear-state"><strong>You are caught up.</strong><span>No second decision is waiting.</span></div>'}</div>
      </section>`;
    nextDecisionHost.querySelectorAll('[data-decision-route]').forEach(button => button.addEventListener('click', () => openDecisionRoute(button.dataset.decisionRoute)));
  }

  const automationFlowHost = el('mission-automation-flow');
  if (automationFlowHost) {
    const modelFlowStatus = modelBlocked ? 'Blocked' : modelRunning > 0 ? 'Running' : modelQueued > 0 ? 'Queued' : 'Ready';
    const nextDailyRun = dailySettings.next_run_at || dailySummary.next_run_at;
    automationFlowHost.innerHTML = `
      <section class="mission-flow-card">
        <div class="mission-section-heading"><div><span class="eyebrow">Automatic workflow</span><h3>What SecOpsAI is doing now</h3></div><span>Human approval remains explicit</span></div>
        <div class="mission-flow">
          <div class="mission-flow-step ${degradedCollectors.length ? 'needs-attention' : 'active'}"><span>1</span><strong>Discovery</strong><small>${collectorRows.length ? `${healthyCollectors}/${collectorRows.length} collectors healthy` : 'Waiting for coverage data'}</small></div>
          <div class="mission-flow-step active"><span>2</span><strong>Evidence</strong><small>${discoveryCandidates} candidate${discoveryCandidates === 1 ? '' : 's'} · static collection only</small></div>
          <div class="mission-flow-step ${modelBlocked ? 'needs-attention' : modelRunning ? 'active' : ''}"><span>3</span><strong>Model review</strong><small>${modelFlowStatus} · ${modelQueued} queued</small></div>
          <div class="mission-flow-step approval"><span>4</span><strong>Decision & publish</strong><small>${publicationReady} ready · operator approval required</small></div>
        </div>
        <div class="mission-automation-policy">
          <div><span>Daily workflow</span><strong>${dailySettings.enabled ? `Enabled${nextDailyRun ? ` · next ${fmtDate(nextDailyRun)}` : ''}` : 'Disabled'}</strong></div>
          <div><span>Alert review</span><strong>${escapeHtml(humanizeSnake(alertAutomation.mode || 'not configured'))}</strong></div>
          <div><span>Investigations</span><strong>${escapeHtml(humanizeSnake(investigationAutomation.mode || 'not configured'))}${investigationAutomation.auto_start_pipeline ? ' · auto-start' : ''}</strong></div>
          <div><span>Specialist routing</span><strong>${escapeHtml(humanizeSnake(specialistPolicy.mode || 'not configured'))}${specialistPolicy.maximum_automatic_tier ? ` · ${escapeHtml(humanizeSnake(specialistPolicy.maximum_automatic_tier))}` : ''}</strong></div>
          <p><strong>${safeAutomationGaps.length ? 'Automation can be improved.' : 'Maximum safe routine automation is enabled.'}</strong> ${safeAutomationGaps.length ? escapeHtml(safeAutomationGaps.join('; ')) : 'Verdicts, containment, sandbox submission, disclosure, publication, deployment, and destructive changes still require a person.'}</p>
        </div>
      </section>`;
  }

  const healthStripHost = el('mission-health-strip');
  if (healthStripHost) {
    const generatedAt = intelligenceData.generated_at || triageLatest?.generated_at || new Date().toISOString();
    healthStripHost.innerHTML = `
      <section class="mission-health-card" aria-label="Workspace health summary">
        <div><span>Findings</span><strong>${openFindingsForCockpit.length} need review</strong></div>
        <div><span>Native triage</span><strong>${triageSummary ? `${triageSummary.open_findings ?? 0} open · ${triageSummary.pending_actions ?? pendingActions.length} pending` : 'Unavailable'}</strong></div>
        <div><span>Model queue</span><strong>${modelRunning} running · ${modelQueued} queued</strong></div>
        <div><span>Source coverage</span><strong>${collectorRows.length ? `${healthyCollectors}/${collectorRows.length} healthy` : 'Not loaded'}</strong></div>
        <div class="mission-health-updated"><span>Updated</span><strong>${escapeHtml(fmtDate(generatedAt))}</strong></div>
      </section>`;
  }

  const cockpitItems = [];
  if (blocked) cockpitItems.push({ tone: 'critical', title: `${blocked} blocked work item${blocked === 1 ? '' : 's'}`, detail: 'Review the blocker and assign the next owner.', page: 'tasks' });
  if (pendingApprovals) cockpitItems.push({ tone: 'high', title: `${pendingApprovals} approval${pendingApprovals === 1 ? '' : 's'} waiting`, detail: 'Review the requested action before it can run.', page: 'integrations' });
  if (openFindingsForCockpit.length) cockpitItems.push({ tone: 'medium', title: `${openFindingsForCockpit.length} open finding${openFindingsForCockpit.length === 1 ? '' : 's'}`, detail: 'Read evidence and decide the next action.', page: 'findings' });
  if (researchReady) cockpitItems.push({ tone: 'high', title: `${researchReady} research case${researchReady === 1 ? '' : 's'} need review`, detail: 'Check evidence, disclosure, or publication readiness.', page: 'research-cases' });
  if (!edgeWorkspaceReady) cockpitItems.push({ tone: 'info', title: 'Asset context is unavailable', detail: 'Check the Edge/Core connection before relying on network changes.', page: 'edge' });

  const attentionHost = el('mission-attention');
  if (attentionHost) {
    attentionHost.innerHTML = `
      <section class="card cockpit-panel">
        <div class="cockpit-panel-head"><div><span class="eyebrow">Operator cockpit</span><h3>Needs attention</h3></div><span class="small">${cockpitItems.length ? `${cockpitItems.length} priority item${cockpitItems.length === 1 ? '' : 's'}` : 'Nothing urgent'}</span></div>
        <div class="cockpit-items">${cockpitItems.length ? cockpitItems.slice(0, 5).map(item => `
          <button class="cockpit-item tone-${escapeHtml(item.tone)}" type="button" data-cockpit-page="${escapeHtml(item.page)}"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span><span aria-hidden="true">›</span></button>
        `).join('') : '<div class="cockpit-clear"><strong>Workspace is clear</strong><span>Continue with scheduled scans, evidence review, or research intake.</span></div>'}</div>
      </section>
      <section class="card cockpit-panel cockpit-summary"><span class="eyebrow">System context</span><h3>Current operating mode</h3><div class="cockpit-facts"><span><strong>${edgeWorkspaceReady ? 'Connected' : 'Degraded'}</strong><small>Asset context</small></span><span><strong>${triageSummary ? 'Available' : 'Unavailable'}</strong><small>Native triage</small></span><span><strong>${state.auth.user?.email ? 'Signed in' : 'Pilot'}</strong><small>Operator session</small></span></div></section>`;
    attentionHost.querySelectorAll('[data-cockpit-page]').forEach(button => button.addEventListener('click', () => setPage(button.dataset.cockpitPage)));
  }

  function drillToTasks({ status = '', external = null, security = null } = {}) {
    setPage('tasks');
    if (el('task-filter-status')) el('task-filter-status').value = status;
    if (external !== null && el('task-filter-external')) el('task-filter-external').checked = !!external;
    if (security !== null && el('task-filter-security')) el('task-filter-security').checked = !!security;
    renderTasks();
  }

  const missionStats = el("mission-stats");
  if (missionStats) {
    missionStats.innerHTML = `
      <div class="card metric-card" data-drill="runs"><div class="metric">${activeRuns}</div><div class="metric-label">Active runs</div><div class="metric-scope">Workspace queue · queued or running</div></div>
      <div class="card metric-card" data-drill="blocked"><div class="metric">${blocked}</div><div class="metric-label">Blocked work</div><div class="metric-scope">Workspace work queue</div></div>
      <div class="card metric-card" data-drill="review"><div class="metric">${inReview}</div><div class="metric-label">In review</div><div class="metric-scope">Workspace work queue</div></div>
      <div class="card metric-card" data-drill="done"><div class="metric">${doneToday}</div><div class="metric-label">Completed today</div><div class="metric-scope">Workspace work queue · local time</div></div>
      <div class="card metric-card" data-drill="sec"><div class="metric">${secReview}</div><div class="metric-label">Needs security review</div><div class="metric-scope">Workspace work queue</div></div>
    `;

    missionStats.querySelectorAll('.metric-card').forEach(card => {
      card.addEventListener('click', () => {
        const kind = card.dataset.drill;
        if (kind === 'blocked') return drillToTasks({ status: 'blocked' });
        if (kind === 'review') return drillToTasks({ status: 'review' });
        if (kind === 'done') return drillToTasks({ status: 'done' });
        if (kind === 'sec') return drillToTasks({ status: '', security: true });
        // active runs: stay on mission control for now (could deep-link to a runs page later)
      });
    });
  }

  const operatorWorkItems = state.workItems.filter(isOperatorWorkItem);
  const byDomain = operatorWorkItems.reduce((acc, item) => {
    acc[item.domain] = (acc[item.domain] || 0) + 1;
    return acc;
  }, {});
  const topDomains = Object.entries(byDomain).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const extFacing = operatorWorkItems.filter(w => w.external_facing).length;
  const openFindings = sortedFindings().filter(f => !['resolved', 'closed', 'done'].includes(String(effectiveFindingStatus(f)).toLowerCase())).length;
  const missionOverview = el("mission-overview");
  if (missionOverview) {
    missionOverview.innerHTML = `
      <div class="card">
        <h3>Top domains</h3>
        <div class="kv-list">
          ${topDomains.length ? topDomains.map(([d, count]) => `<div class="kv-row"><div class="kv-key">${escapeHtml(d)}</div><div class="kv-val">${count}</div></div>`).join('') : '<div class="empty">No work item distribution yet.</div>'}
        </div>
      </div>
      <div class="card metric-card" id="mc-external-facing" style="cursor:pointer;">
        <h3>External-facing work</h3>
        <div class="metric">${extFacing}</div>
        <div class="metric-label">Items that need careful operator and security review</div>
      </div>
      <div class="card metric-card" id="mc-open-findings" style="cursor:pointer;">
        <h3>Open findings</h3>
        <div class="metric">${openFindings}</div>
        <div class="metric-label">Findings that still need triage or closure</div>
      </div>
      <div class="card metric-card" id="mc-native-triage" style="cursor:pointer;">
        <h3>Native triage</h3>
        <div class="metric">${triageSummary ? `${triageSummary.open_findings ?? 0} / ${triageSummary.pending_actions ?? pendingActions.length}` : '—'}</div>
        <div class="metric-label">${triageSummary ? `open findings / pending actions • ${openSessions} sessions • ${pendingApprovals} pending approvals` : 'local SecOpsAI triage helper unavailable'}</div>
      </div>
      <div class="card">
        <h3>Latest orchestrator run</h3>
        ${triageLatest ? `
          <div class="kv-list">
            <div class="kv-row"><div class="kv-key">Generated</div><div class="kv-val">${escapeHtml(fmtDate(triageLatest.generated_at))}</div></div>
            <div class="kv-row"><div class="kv-key">Processed</div><div class="kv-val">${escapeHtml(triageLatest.processed ?? '—')}</div></div>
            <div class="kv-row"><div class="kv-key">Queued</div><div class="kv-val">${escapeHtml(triageLatest.queued ?? triageLatest.pending_actions ?? 0)}</div></div>
            <div class="kv-row"><div class="kv-key">Auto applied</div><div class="kv-val">${escapeHtml(triageLatest.auto_applied ?? triageLatest.applied_actions ?? 0)}</div></div>
          </div>
          <div class="small" style="margin-top:12px;">${escapeHtml((triageLatest.findings?.[0]?.summary || 'Recent SecOpsAI orchestration summary available locally.').slice(0, 180))}</div>
        ` : '<div class="empty">No orchestrator summary found yet.</div>'}
      </div>
    `;

    el('mc-external-facing')?.addEventListener('click', () => {
      setPage('tasks');
      if (el('task-filter-external')) el('task-filter-external').checked = true;
      if (el('task-filter-status')) el('task-filter-status').value = '';
      renderTasks();
    });
    el('mc-open-findings')?.addEventListener('click', () => setPage('findings'));
    el('mc-native-triage')?.addEventListener('click', () => setPage('findings'));
  }

  const queueHost = el('mission-research-queues');
  if (queueHost) {
    const candidates = Array.isArray(state.researchCases.discovery?.candidates) ? state.researchCases.discovery.candidates : [];
    const cases = Array.isArray(state.researchCases.cases) ? state.researchCases.cases : [];
    const validationBlockers = cases.filter(item => ['validation', 'awaiting_input', 'blocked'].includes(String(item.status || '').toLowerCase())).length;
    const disclosureDeadlines = cases.filter(item => ['disclosure_pending', 'coordinating'].includes(String(item.status || '').toLowerCase())).length;
    const publishReady = cases.filter(item => String(item.status || '').toLowerCase() === 'ready_to_publish').length;
    const coverageGaps = Array.isArray(state.coverage.collectors) ? state.coverage.collectors.filter(item => coverageCollectorHealth(item) !== 'Healthy').length : 0;
    const queueItems = [
      ['New candidates', candidates.length, 'Review explainable registry leads', 'research/inbox'],
      ['Validation blockers', validationBlockers, 'Collect or review missing evidence', 'research/cases'],
      ['Disclosure coordination', disclosureDeadlines, 'Prepare approved external contact', 'research/disclosure'],
      ['Publication ready', publishReady, 'Open editorial safety review', 'publications/review'],
      ['Degraded collectors', coverageGaps, 'Inspect registry coverage health', 'research/coverage']
    ];
    queueHost.innerHTML = queueItems.map(([label, value, detail, route]) => `<button class="mission-queue" type="button" data-queue-route="${escapeHtml(route)}"><span class="mission-queue-count">${escapeHtml(String(value))}</span><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></span></button>`).join('');
    queueHost.querySelectorAll('[data-queue-route]').forEach(button => button.addEventListener('click', () => setPage(pageIdForRoute(button.dataset.queueRoute), { routeOverride: button.dataset.queueRoute })));
  }

  const activitySince = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const recentFeed = [...state.events]
    .filter(event => !isInternalDevelopmentRecord(event))
    .filter(event => Number.isFinite(new Date(event.created_at).getTime()) && new Date(event.created_at).getTime() >= activitySince)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 6);
  const eventsEl = el("mission-events");
  if (eventsEl) {
    eventsEl.innerHTML = recentFeed.length ? recentFeed.map(ev => `
      <div class="feed-item" style="border-left-color:${ev.severity === 'error' ? '#ef4444' : ev.severity === 'success' ? '#10b981' : ev.severity === 'warning' ? '#f59e0b' : '#06b6d4'}">
        <div><strong>${escapeHtml(ev.title)}</strong></div>
        <div class="meta">${escapeHtml(statusLabel(ev.event_type || 'activity'))} • ${fmtDate(ev.created_at)}</div>
      </div>
    `).join("") : `<div class="empty">No dashboard events yet.</div>`;
  }

  const recentRuns = [...state.runs]
    .filter(run => String(run.runtime || '').toLowerCase() !== 'dashboard-auto' && !isInternalDevelopmentRecord(run))
    .filter(run => Number.isFinite(new Date(run.created_at).getTime()) && new Date(run.created_at).getTime() >= activitySince)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 6);
  const runsEl = el("mission-runs");
  if (runsEl) {
    runsEl.innerHTML = recentRuns.length ? recentRuns.map(run => `
      <div class="feed-item" style="border-left-color:${cfg.departments[roleDepartment(run.role_label)] || '#06b6d4'}">
        <div><strong>${escapeHtml(run.role_label)}</strong> — ${escapeHtml(run.task_summary)}</div>
        <div class="meta">${escapeHtml(statusLabel(run.status))} • ${escapeHtml(run.runtime || '—')} • ${fmtDate(run.created_at)}</div>
      </div>
    `).join("") : `<div class="empty">No agent runs yet.</div>`;
  }
}


function renderWorkTable(items) {
  const table = el('work-table');
  if (!table) return;
  if (!items.length) {
    table.innerHTML = '<div class="empty-state"><strong>No work matches these filters.</strong><div class="small">Clear a filter or create a task to start an accountable workflow.</div></div>';
    return;
  }
  const priorityOrder = { urgent: 4, high: 3, normal: 2, low: 1 };
  const sorted = [...items].sort((a, b) => {
    const priority = (priorityOrder[String(b.priority || 'normal').toLowerCase()] || 0) - (priorityOrder[String(a.priority || 'normal').toLowerCase()] || 0);
    return priority || new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
  });
  table.innerHTML = `
    <div class="table-wrap work-table-wrap"><table>
      <thead><tr><th>Work item</th><th>Status</th><th>Priority</th><th>Owner</th><th>Updated</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${sorted.map(item => `
        <tr>
          <td><button class="table-link work-open-btn" type="button" data-task-id="${escapeHtml(item.id)}">${escapeHtml(item.title || 'Untitled work')}</button><div class="small">${escapeHtml(compactText(item.description || 'No description yet.', 140))}</div></td>
          <td>${renderStatusPill(item.status || 'inbox', humanizeSnake(item.status || 'inbox'))}</td>
          <td><span class="severity-label severity-${escapeHtml(item.priority || 'normal')}">${escapeHtml(item.priority || 'normal')}</span></td>
          <td>${item.owner_role ? escapeHtml(shortRoleLabel(item.owner_role)) : '<span class="small">Unassigned</span>'}</td>
          <td><span class="small">${escapeHtml(fmtDate(item.updated_at || item.created_at))}</span></td>
          <td><button class="mini-btn work-open-btn" type="button" data-task-id="${escapeHtml(item.id)}">Open</button></td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  table.querySelectorAll('.work-open-btn').forEach(button => {
    button.addEventListener('click', () => {
      const item = state.workItems.find(workItem => String(workItem.id) === String(button.dataset.taskId));
      if (item) openTaskModal(item);
    });
  });
}

function updateWorkViewControls() {
  el('work-table-view-btn')?.classList.toggle('active', workView === 'table');
  el('work-board-view-btn')?.classList.toggle('active', workView === 'board');
}

function getFindingFilters() {
  return {
    search: (el('finding-search')?.value || '').trim().toLowerCase(),
    severity: (el('finding-filter-severity')?.value || '').toLowerCase(),
    status: (el('finding-filter-status')?.value || '').toLowerCase(),
    source: (el('finding-filter-source')?.value || '').toLowerCase()
  };
}

function filteredFindings(items = sortedFindings()) {
  const filters = getFindingFilters();
  return items.filter(finding => {
    const severity = String(findingSeverity(finding) || '').toLowerCase();
    const status = String(effectiveFindingStatus(finding) || '').toLowerCase();
    const source = String(findingSource(finding) || '').toLowerCase();
    if (filters.severity === 'priority' && !['critical', 'high', 'urgent'].includes(severity)) return false;
    if (filters.severity && filters.severity !== 'priority' && severity !== filters.severity) return false;
    if (filters.status && status !== filters.status) return false;
    if (filters.source) {
      if (filters.source === 'secopsai_edge' && !source.includes('edge') && !String(finding.finding_id || '').toUpperCase().startsWith('EDGE-')) return false;
      if (filters.source === 'secopsai_core' && findingRecordOrigin(finding) !== 'core') return false;
      if (filters.source === 'ai_dependency_guard' && !source.includes('ai') && !source.includes('dependency')) return false;
      if (filters.source === 'supply_chain_all' && !/(?:supply.?chain|dependency|package|npm|pypi|nuget|maven|rubygems|packagist|open-vsx)/i.test(source)) return false;
    }
    if (filters.search) {
      const haystack = `${findingId(finding) || ''} ${findingTitle(finding)} ${findingBody(finding)} ${findingSource(finding)} ${findingValue(finding, 'asset') || ''}`.toLowerCase();
      if (!haystack.includes(filters.search)) return false;
    }
    return true;
  });
}

function specialistStatusResult() {
  const data = state.specialists.data || {};
  return data.result || data;
}

function specialistProfiles() {
  return specialistStatusResult()?.catalog?.profiles || [];
}

function specialistFallbackLabel(modelRouting = {}) {
  const mode = String(modelRouting.fallback_mode || 'disabled');
  const models = Array.isArray(modelRouting.fallback_models) ? modelRouting.fallback_models : [];
  if (mode === 'disabled') return 'Disabled; no silent model switching';
  return `${humanizeSnake(mode)} · ${models.length ? models.join(' → ') : 'no fallback models configured'}`;
}

function renderSpecialistOverview() {
  const summary = el('specialist-status-grid');
  const policyStrip = el('specialist-policy-strip');
  const roster = el('specialist-roster');
  const runsEl = el('specialist-runs');
  if (!summary || !policyStrip || !roster || !runsEl) return;
  const data = specialistStatusResult();
  if (state.specialists.loading && !state.specialists.data) {
    summary.innerHTML = '<div class="empty-state compact">Loading specialist roster and OpenCodex routing…</div>';
    return;
  }
  if (state.specialists.error && !state.specialists.data) {
    summary.innerHTML = `<div class="empty-state compact"><strong>Local Specialist Orchestrator unavailable</strong><div class="small">${escapeHtml(state.specialists.error)} Start the local helper to route or run repository work.</div></div>`;
    policyStrip.innerHTML = '<strong>Hosted-safe behavior:</strong> no helper-backed execution is attempted when the local orchestrator is unavailable.';
    roster.innerHTML = '';
    runsEl.innerHTML = '';
    return;
  }
  const catalog = data.catalog || {};
  const model = data.model_routing || {};
  const policy = data.policy || {};
  const runs = Array.isArray(data.runs) ? data.runs : [];
  const activeRuns = runs.filter(run => !['completed', 'needs_review', 'failed', 'canceled'].includes(String(run.status || ''))).length;
  summary.innerHTML = `
    <div class="specialist-status-item"><span>Reviewed roster</span><strong>${escapeHtml(String(catalog.profile_count || 0))} specialists</strong><small>Catalog ${escapeHtml(String(catalog.version || 'unknown'))} · pinned and catalog-validated</small></div>
    <div class="specialist-status-item"><span>Selected OpenCodex model</span><strong>${escapeHtml(model.primary_model || 'Not selected')}</strong><small>${escapeHtml(model.source || 'runtime')} routing snapshot</small></div>
    <div class="specialist-status-item"><span>Fallback policy</span><strong>${escapeHtml(humanizeSnake(model.fallback_mode || 'disabled'))}</strong><small>${escapeHtml(specialistFallbackLabel(model))}</small></div>
    <div class="specialist-status-item"><span>Active work</span><strong>${escapeHtml(String(activeRuns))} active</strong><small>${escapeHtml(String(runs.length))} recent durable run${runs.length === 1 ? '' : 's'}</small></div>`;
  policyStrip.innerHTML = `<strong>Automation policy: ${escapeHtml(humanizeSnake(policy.mode || 'recommend'))}</strong><span>Automatic ceiling: ${escapeHtml(humanizeSnake(policy.maximum_automatic_tier || 'recommend'))}</span><span>Independent review: ${policy.independent_review === false ? 'off' : 'required'}</span><span>Worktrees, PR-ready delivery, merge, deploy, publish, disclosure, cloud mutation, secrets, and destructive actions are never automatic.</span>`;
  const policyMode = el('specialist-policy-mode');
  const policyTier = el('specialist-policy-tier');
  // Background status refreshes must not replace a policy the operator is editing.
  if (!state.specialists.policyDirty && !state.specialists.policySaving) {
    if (policyMode) policyMode.value = policy.mode || 'recommend';
    if (policyTier) policyTier.value = policy.maximum_automatic_tier || 'recommend';
  }
  if (policyTier) policyTier.disabled = (policyMode?.value || policy.mode) !== 'guarded';
  const catalogVersion = String(catalog.version || 'unknown');
  const upstreamCommit = String(catalog.upstream?.commit || '').slice(0, 12);
  roster.innerHTML = `<div class="specialist-roster-grid">${specialistProfiles().map(profile => `
    <div class="specialist-roster-item"><strong>${escapeHtml(profile.name || profile.id)}</strong><span>${escapeHtml(profile.id || '')} · catalog ${escapeHtml(catalogVersion)}</span><small>${escapeHtml(profile.source_path || 'reviewed local profile')}${profile.source_sha256 ? ` · sha256 ${escapeHtml(String(profile.source_sha256).slice(0, 12))}…` : ''}${upstreamCommit ? ` · upstream ${escapeHtml(upstreamCommit)}` : ''}</small></div>`).join('')}</div>`;
  runsEl.innerHTML = !runs.length
    ? '<div class="empty-state compact"><strong>No specialist runs yet.</strong><div class="small">Open a work item, review the recommendation, and choose an automation tier.</div></div>'
    : `<div class="module-head compact-header"><div><h4>Recent specialist runs</h4><p>Latest first · model and policy are captured when each run is created.</p></div></div><div class="table-wrap"><table><thead><tr><th>Work</th><th>Specialist</th><th>Tier</th><th>Model</th><th>Status</th><th>Updated</th></tr></thead><tbody>${runs.slice(0, 10).map(run => `
      <tr><td><strong>${escapeHtml(run.title || run.run_id)}</strong><div class="small mono">${escapeHtml(run.run_id || '')}</div></td><td>${escapeHtml(humanizeSnake(String(run.primary_profile_id || '').split('/').pop() || 'unknown'))}</td><td>${escapeHtml(humanizeSnake(run.automation_tier || 'recommend'))}</td><td><span class="mono">${escapeHtml(run.selected_model || 'not selected')}</span></td><td>${renderStatusPill(run.status || 'unknown', humanizeSnake(run.status || 'unknown'))}</td><td>${escapeHtml(fmtDate(run.updated_at || run.created_at))}</td></tr>`).join('')}</tbody></table></div>`;
}

function populatePromptSpecialistSelect() {
  const select = el('prompt-specialist-select');
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Automatic recommendation</option>${specialistProfiles().map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name || profile.id)}</option>`).join('')}`;
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

function specialistTaskFromItem(item = {}) {
  return {
    task_id: item.id ? String(item.id) : '',
    title: String(item.title || 'Untitled work'),
    description: String(item.description || ''),
    domain: String(item.domain || ''),
    priority: String(item.priority || 'normal'),
    status: String(item.status || 'inbox'),
    owner_role: String(item.owner_role || ''),
    reviewer_role: String(item.reviewer_role || ''),
    external_facing: Boolean(item.external_facing),
    requires_security_review: Boolean(item.requires_security_review),
    evidence_refs: item.id ? [`work-item:${item.id}`] : []
  };
}

async function loadSpecialists({ render = true } = {}) {
  state.specialists.loading = true;
  if (render) renderSpecialistOverview();
  try {
    const response = await dashboardApiFetch('/api/secopsai/specialists');
    const payload = await response.json().catch(() => ({}));
    state.specialists.data = payload;
    state.specialists.error = response.ok ? null : (payload.error || `Specialist status HTTP ${response.status}`);
  } catch (error) {
    state.specialists.error = error?.message || String(error);
  } finally {
    state.specialists.loading = false;
    if (render) renderSpecialistOverview();
    populatePromptSpecialistSelect();
  }
  return state.specialists.data;
}

async function specialistApiAction(action, payload = {}, button = null, { write = true } = {}) {
  const tokenInput = el('intelligence-admin-token');
  state.intelligence.adminToken = tokenInput?.value?.trim() || state.intelligence.adminToken;
  if (write && !state.intelligence.adminToken) {
    showToast('Enter the Automation action token in Administration → Automation before using this protected action.', 'error');
    tokenInput?.focus();
    return null;
  }
  if (state.intelligence.adminToken) sessionStorage.setItem('secopsai_intelligence_admin_token', state.intelligence.adminToken);
  setButtonBusy(button, true, action === 'route' ? 'Routing…' : 'Working…');
  try {
    const response = await dashboardApiFetch('/api/secopsai/specialists', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(write && state.intelligence.adminToken ? { 'X-SecOpsAI-Intelligence-Token': state.intelligence.adminToken } : {})
      },
      body: JSON.stringify({ action, ...payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || `Specialist action HTTP ${response.status}`);
    return result.result || result;
  } catch (error) {
    showToast(error?.message || String(error), 'error');
    return null;
  } finally {
    setButtonBusy(button, false);
  }
}

async function saveSpecialistPolicy(button = null) {
  const mode = el('specialist-policy-mode')?.value || 'recommend';
  const maximumTier = mode === 'guarded' ? (el('specialist-policy-tier')?.value || 'recommend') : 'recommend';
  state.specialists.policySaving = true;
  try {
    const result = await specialistApiAction('policy', {
      mode,
      maximum_automatic_tier: maximumTier
    }, button);
    if (!result) return;
    if (result.mode !== mode || result.maximum_automatic_tier !== maximumTier) {
      throw new Error('The saved specialist policy did not match your selection. Your edits were preserved; retry after refreshing the helper.');
    }
    state.specialists.policyDirty = false;
    await loadSpecialists();
    const persisted = specialistStatusResult()?.policy || {};
    if (persisted.mode !== mode || persisted.maximum_automatic_tier !== maximumTier) {
      state.specialists.policyDirty = true;
      throw new Error('The specialist policy could not be verified after save. Your selected values remain in the form.');
    }
    showToast('Specialist automatic routing policy saved and verified.', 'success');
  } catch (error) {
    state.specialists.policyDirty = true;
    showToast(error?.message || String(error), 'error');
  } finally {
    state.specialists.policySaving = false;
  }
}

async function autoRouteNextWorkItem(button = null) {
  const priorityOrder = { urgent: 4, high: 3, normal: 2, low: 1 };
  const next = filteredWorkItems()
    .filter(item => !['done', 'review'].includes(String(item.status || '').toLowerCase()))
    .sort((a, b) => (priorityOrder[String(b.priority || 'normal').toLowerCase()] || 0) - (priorityOrder[String(a.priority || 'normal').toLowerCase()] || 0))[0];
  if (!next) {
    showToast('No open work item matches the current Work filters.', 'info');
    return;
  }
  const result = await specialistApiAction('auto-route', { task: specialistTaskFromItem(next) }, button);
  if (!result) return;
  if (!result.routed) {
    showToast(result.reason || 'Automatic specialist routing is disabled.', 'info');
  } else {
    const run = result.run || {};
    showToast(`${next.title}: ${humanizeSnake(result.effective_tier || 'recommend')} route created${run.run_id ? ` (${run.run_id})` : ''}.`, 'success', 6000);
  }
  await loadSpecialists();
}

function specialistContractForPrompt() {
  return promptModalState.specialistRun?.contract || promptModalState.specialistContract || null;
}

function renderPromptSpecialist() {
  populatePromptSpecialistSelect();
  const target = el('prompt-specialist-summary');
  if (!target) return;
  const contract = specialistContractForPrompt();
  const run = promptModalState.specialistRun;
  const tier = el('prompt-specialist-tier')?.value || 'recommend';
  const createButton = el('prompt-specialist-create-btn');
  const refreshRunButton = el('prompt-specialist-refresh-run-btn');
  const approveButton = el('prompt-specialist-approve-btn');
  const executeButton = el('prompt-specialist-execute-btn');
  const cancelButton = el('prompt-specialist-cancel-btn');
  const labels = { recommend: 'Save recommendation', read_only: 'Queue read-only analysis', worktree: 'Create approval request', pr_ready: 'Prepare PR-ready worktree' };
  if (createButton) createButton.textContent = labels[tier] || 'Create specialist run';
  if (!contract) {
    target.innerHTML = '<div class="empty-state compact">Calculating a deterministic specialist route…</div>';
    [refreshRunButton, approveButton, executeButton, cancelButton].forEach(button => button?.classList.add('hidden'));
    return;
  }
  const routing = contract.routing || {};
  const specialist = contract.specialist || {};
  const model = contract.model_routing || {};
  const policy = contract.execution_policy || {};
  const repository = contract.repository || {};
  const evidence = contract.evidence_requirements || {};
  const status = run?.status || 'preview';
  const modelMissing = !model.primary_model && tier !== 'recommend';
  if (createButton) {
    createButton.disabled = modelMissing || Boolean(run && !['completed', 'needs_review', 'failed', 'canceled'].includes(String(run.status || '')));
    createButton.title = modelMissing ? 'Select and persist an OpenCodex model in Automation first.' : '';
  }
  approveButton?.classList.toggle('hidden', status !== 'awaiting_approval');
  executeButton?.classList.toggle('hidden', !(status === 'ready' && ['worktree', 'pr_ready'].includes(String(run?.automation_tier || tier))));
  cancelButton?.classList.toggle('hidden', !run || ['completed', 'needs_review', 'failed', 'canceled'].includes(status));
  refreshRunButton?.classList.toggle('hidden', !run);
  const reasons = routing.reasons || [];
  const missing = evidence.missing || [];
  const allowed = policy.allowed_actions || [];
  target.innerHTML = `
    ${run ? `<div class="specialist-policy-strip"><strong>${escapeHtml(run.run_id || '')}</strong><span>${renderStatusPill(status, humanizeSnake(status))}</span><span>Approval: ${escapeHtml(humanizeSnake(run.approval_state || 'not required'))}</span></div>` : ''}
    <div class="specialist-route-grid">
      <div class="specialist-route-panel"><strong>Primary specialist</strong><p>${escapeHtml(routing.primary_profile_name || specialist.profile?.name || 'Unknown')}<br><span class="mono">${escapeHtml(routing.primary_profile_id || specialist.profile?.id || '')}</span><br>Catalog ${escapeHtml(specialist.catalog_version || 'unknown')} · ${escapeHtml(specialist.profile?.source_path || 'reviewed local profile')}<br>Confidence ${escapeHtml(routing.confidence || 'unknown')} · risk ${escapeHtml(routing.risk || 'unknown')}</p></div>
      <div class="specialist-route-panel"><strong>Independent reviewer</strong><p>${escapeHtml(routing.reviewer_profile_name || specialist.reviewer?.name || 'Unknown')}<br><span class="mono">${escapeHtml(routing.reviewer_profile_id || specialist.reviewer?.id || '')}</span><br>${escapeHtml(specialist.reviewer?.source_path || 'reviewed local profile')}<br>Required before operator acceptance.</p></div>
      <div class="specialist-route-panel"><strong>OpenCodex model snapshot</strong><p><span class="mono">${escapeHtml(model.primary_model || 'Not selected')}</span><br>${escapeHtml(specialistFallbackLabel(model))}<br>Source: ${escapeHtml(model.source || 'runtime')}</p></div>
      <div class="specialist-route-panel"><strong>Execution boundary</strong><p>${escapeHtml(humanizeSnake(policy.tier || tier))} · ${policy.approval_required ? 'approval required' : 'no execution approval required'}<br>${escapeHtml(String(policy.max_runtime_seconds || 0))} second budget · ${escapeHtml(String(policy.max_retries ?? 0))} retry budget<br>${escapeHtml(String(policy.max_files_changed || 0))} file limit · network and external tools disabled<br>Repository: ${escapeHtml(repository.alias || contract.repo_alias || 'not selected')}<br>Reviewed base: <span class="mono">${escapeHtml(repository.base_commit ? repository.base_commit.slice(0, 12) : humanizeSnake(repository.snapshot_status || 'unavailable'))}</span></p></div>
      <div class="specialist-route-panel"><strong>Why this route</strong>${reasons.length ? `<ul>${reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : '<p>No routing reason returned.</p>'}</div>
      <div class="specialist-route-panel"><strong>Evidence and permissions</strong>${missing.length ? `<ul>${missing.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : '<p>Minimum intake evidence is present.</p>'}<p>Allowed: ${escapeHtml(allowed.join('; ') || 'recommendation only')}.</p></div>
    </div>
    ${modelMissing ? '<div class="error" style="margin-top:10px;">No persisted OpenCodex model is available. Select one in Administration → Automation. SecOpsAI will not choose another model silently.</div>' : ''}
    ${run?.result?.output?.summary ? `<div class="specialist-route-panel" style="margin-top:8px;"><strong>Primary result</strong><p>${escapeHtml(run.result.output.summary)}</p></div>` : ''}
    ${run?.review?.output?.summary ? `<div class="specialist-route-panel" style="margin-top:8px;"><strong>Independent review</strong><p>${escapeHtml(run.review.output.summary)}</p></div>` : ''}`;
}

async function routePromptSpecialist(button = null) {
  if (!promptModalState.item) return null;
  const contract = await specialistApiAction('route', {
    task: specialistTaskFromItem(promptModalState.item),
    tier: el('prompt-specialist-tier')?.value || 'recommend',
    profile_id: el('prompt-specialist-select')?.value || ''
  }, button, { write: false });
  if (contract) {
    promptModalState.specialistContract = contract;
    promptModalState.specialistRun = null;
    renderPromptSpecialist();
  }
  return contract;
}

async function createPromptSpecialistRun(button = null) {
  const tier = el('prompt-specialist-tier')?.value || 'recommend';
  const run = await specialistApiAction('create', {
    task: specialistTaskFromItem(promptModalState.item || {}),
    tier,
    profile_id: el('prompt-specialist-select')?.value || '',
    enqueue: tier === 'read_only'
  }, button);
  if (!run) return;
  promptModalState.specialistRun = run;
  state.specialists.selectedRunId = run.run_id || null;
  showToast(tier === 'read_only' ? 'Read-only OpenCodex specialist analysis queued.' : 'Specialist run created.', 'success');
  renderPromptSpecialist();
  await loadSpecialists();
  startPromptSpecialistPolling();
}

async function refreshPromptSpecialistRun() {
  const runId = promptModalState.specialistRun?.run_id;
  if (!runId) return;
  try {
    const response = await dashboardApiFetch(`/api/secopsai/specialists/${encodeURIComponent(runId)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Specialist run HTTP ${response.status}`);
    promptModalState.specialistRun = payload.run;
    renderPromptSpecialist();
    if (['completed', 'needs_review', 'failed', 'canceled'].includes(String(payload.run?.status || ''))) {
      if (promptModalState.specialistPollTimer) clearInterval(promptModalState.specialistPollTimer);
      promptModalState.specialistPollTimer = null;
      await loadSpecialists();
    }
  } catch (error) {
    showToast(error?.message || String(error), 'error');
  }
}

function startPromptSpecialistPolling() {
  if (promptModalState.specialistPollTimer) clearInterval(promptModalState.specialistPollTimer);
  const status = String(promptModalState.specialistRun?.status || '');
  if (!['queued', 'running', 'awaiting_review'].includes(status)) return;
  promptModalState.specialistPollTimer = setInterval(() => refreshPromptSpecialistRun(), 4000);
}

async function mutatePromptSpecialistRun(action, button) {
  const run = promptModalState.specialistRun;
  if (!run?.run_id) return;
  if (action === 'approve' && !(await requestConfirmation('Approve this isolated worktree run?', { title: 'Approve specialist worktree', context: 'The selected OpenCodex model may edit only the allowlisted repository inside a new isolated worktree. Merge, push, deploy, publish, disclosure, secrets, and destructive actions remain blocked.', confirmLabel: 'Approve worktree' }))) return;
  if (action === 'execute' && !(await requestConfirmation('Run the approved specialist in its isolated worktree now?', { title: 'Run OpenCodex specialist', context: 'The run uses the captured model and explicit fallback policy. Its diff remains local and must pass independent review before operator acceptance.', confirmLabel: 'Run in worktree' }))) return;
  if (action === 'cancel' && !(await requestConfirmation('Cancel this specialist run?', { title: 'Cancel specialist run', context: 'Audit history and any existing recovery worktree will be preserved.', confirmLabel: 'Cancel run' }))) return;
  const updated = await specialistApiAction(action, { run_id: run.run_id }, button);
  if (!updated) return;
  promptModalState.specialistRun = updated;
  renderPromptSpecialist();
  await loadSpecialists();
  startPromptSpecialistPolling();
}

function renderTasks() {
  renderSpecialistOverview();
  const statuses = [["inbox", "Inbox"],["planned", "Planned"],["in_progress", "In Progress"],["review", "Review"],["blocked", "Blocked"],["done", "Done"]];
  const board = el("task-board");
  const table = el('work-table');
  if (!board && !table) return;
  const visibleItems = filteredWorkItems();
  updateWorkViewControls();
  if (table) table.classList.toggle('hidden', workView !== 'table');
  if (board) board.classList.toggle('hidden', workView !== 'board');
  if (workView === 'table') {
    renderWorkTable(visibleItems);
    return;
  }
  if (!board) return;
  board.innerHTML = "";

  statuses.forEach(([status, label]) => {
    const priorityOrder = { urgent: 4, high: 3, normal: 2, low: 1 };
    const items = visibleItems.filter(w => w.status === status).sort((a, b) => { const pa = priorityOrder[String(a.priority || 'normal').toLowerCase()] || 0; const pb = priorityOrder[String(b.priority || 'normal').toLowerCase()] || 0; if (pb !== pa) return pb - pa; return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at); });
    const col = document.createElement("div");
    col.className = `column column-${status}`;
    col.dataset.status = status;
    col.innerHTML = `
      <div class="column-head">
        <div>
          <h3>${label}</h3>
          <div class="column-subtitle">${status === 'inbox' ? 'New or unsorted work' : status === 'planned' ? 'Ready for execution' : status === 'in_progress' ? 'Actively being worked' : status === 'review' ? 'Needs verification or approval' : status === 'blocked' ? 'Waiting on blocker' : 'Finished work'}<\/div>
        <\/div>
        <div class="column-count">${items.length}<\/div>
      <\/div>
      <div class="task-list"><\/div>`;
    const list = col.querySelector(".task-list");

    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain') || dragState.taskId;
      if (!taskId) return;
      await moveTaskToStatus(taskId, status);
    });

    if (!items.length) {
      list.innerHTML = `<div class="empty">No items in ${label.toLowerCase()}.</div>`;
    } else {
      items.forEach(item => {
        const div = document.createElement("div");
        div.className = `task-card priority-${String(item.priority || 'normal').toLowerCase()}`;
        div.draggable = true;
        div.dataset.taskId = item.id;
        const liveReq = latestRunRequestForTask(item.id);
        const liveRun = liveReq ? relatedRunForRequest(liveReq) : null;
        const liveLifecycle = liveReq ? runRequestLifecycle(liveReq, liveRun) : null;
        div.innerHTML = `
          <div class="task-card-top">
            <div class="title">${escapeHtml(item.title)}</div>
            <div class="task-card-top-right">
              <div class="task-card-status">${escapeHtml(label)}</div>
              ${liveLifecycle ? `<div class="task-card-live ${escapeHtml(liveLifecycle.displayStatus)}">${escapeHtml(liveLifecycle.displayLabel)}</div>` : ''}
            </div>
          </div>
          <div class="small task-card-desc">${escapeHtml(item.description || 'No description yet.')}</div>
          <div class="badges">
            <span class="badge domain-${escapeHtml(item.domain)}">${escapeHtml(item.domain)}</span>
            <span class="badge priority-${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span>
            ${item.owner_role ? `<span class="badge">${escapeHtml(shortRoleLabel(item.owner_role))}</span>` : ''}
            ${item.external_facing ? `<span class="badge external">external-facing</span>` : ''}
            ${item.requires_security_review ? `<span class="badge review">security review</span>` : ''}
          </div>
          <div class="small" style="margin-top:10px;">Updated ${escapeHtml(fmtDate(item.updated_at || item.created_at))}</div>
          <div class="task-card-actions">
            <button class="mini-btn" data-action="assign-owner">Suggest owner</button>
            <button class="mini-btn" data-action="assign-reviewer">Suggest reviewer</button>
            <button class="mini-btn" data-action="prompt">Open brief</button>
          </div>
        `;
        div.addEventListener('dragstart', (e) => {
          dragState.taskId = item.id;
          e.dataTransfer.setData('text/plain', item.id);
          e.dataTransfer.effectAllowed = 'move';
          div.classList.add('dragging');
        });
        div.addEventListener('dragend', () => {
          dragState.taskId = null;
          div.classList.remove('dragging');
          document.querySelectorAll('.column.drag-over').forEach(elm => elm.classList.remove('drag-over'));
        });
        div.addEventListener('click', (event) => {
          if (dragState.taskId) return;
          const action = event.target?.dataset?.action;
          if (action === 'assign-owner') {
            event.stopPropagation();
            Promise.resolve()
              .then(() => assignSuggestedOwnerForTask(item))
              .catch(err => {
                console.error('assign suggested owner failed', err);
                notifyError(`Failed to assign suggested owner: ${err.message || err}`);
              });
            return;
          }
          if (action === 'assign-reviewer') {
            event.stopPropagation();
            Promise.resolve()
              .then(() => assignSuggestedReviewerForTask(item))
              .catch(err => {
                console.error('assign suggested reviewer failed', err);
                notifyError(`Failed to assign suggested reviewer: ${err.message || err}`);
              });
            return;
          }
          if (action === 'prompt') { event.stopPropagation(); openPromptModal(item); return; }
          openTaskModal(item);
        });
        list.appendChild(div);
      });
    }
    board.appendChild(col);
  });
}

function renderFindings() {
  const allFindings = sortedFindings();
  const findings = filteredFindings(allFindings);
  const coreFindingCount = findings.filter(finding => findingRecordOrigin(finding) === 'core').length;
  const dashboardFindingCount = findings.length - coreFindingCount;
  const findingsAvailable = state.optionalTables.findings !== false || coreFindingCount > 0;
  if (state.selectedFindingId && !findings.some(finding => String(findingId(finding)) === String(state.selectedFindingId)) && Object.values(getFindingFilters()).some(Boolean)) {
    state.selectedFindingId = null;
  }
  const triageSummary = localTriageSummary();
  const triageLatest = localTriageLatestRun();
  const pendingActions = localPendingActions();
  const openSessions = openLocalSessionsCount();
  const pendingApprovals = pendingLocalApprovalsCount();
  const summary = el('finding-summary');
  const total = findings.length;
  const aiGuardCount = aiDependencyGuardFindings(findings).length;
  const openCount = findings.filter(f => !['resolved', 'closed', 'done'].includes(String(effectiveFindingStatus(f)).toLowerCase())).length;
  const criticalCount = findings.filter(f => ['critical', 'urgent'].includes(String(findingSeverity(f)).toLowerCase())).length;
  const linkedCount = findings.filter(f => relatedTasksForFinding(f).length > 0).length;
  const actionableCount = findings.filter(f => {
    const related = relatedTasksForFinding(f);
    return related.length === 0 || (related[0]?.item?.status && !['done', 'review'].includes(related[0].item.status));
  }).length;
  if (summary) {
    summary.innerHTML = `
      <div class="card finding-summary-card priority"><div class="metric">${openCount}</div><div class="metric-label">Need a decision</div><div class="metric-scope">${actionableCount} need action or follow-up</div></div>
      <div class="card finding-summary-card"><div class="metric">${criticalCount}</div><div class="metric-label">Critical or urgent</div><div class="metric-scope">Priority is not a maliciousness verdict</div></div>
      <div class="card finding-summary-card"><div class="metric">${linkedCount}</div><div class="metric-label">Have accountable work</div><div class="metric-scope">Task or remediation linked</div></div>
      <div class="card finding-summary-card"><div class="metric">${aiGuardCount}</div><div class="metric-label">AI Dependency Guard risks</div><div class="metric-scope">Slopsquatting and dependency guard</div></div>
      <div class="finding-summary-context"><strong>${total} shown</strong><span>${coreFindingCount} canonical Core · ${dashboardFindingCount} operational</span><span>${triageSummary ? `${triageSummary.open_findings ?? 0} native open · ${triageSummary.pending_actions ?? pendingActions.length} pending` : 'Native triage unavailable'}</span><span>${openSessions} sessions · ${pendingApprovals} approvals</span></div>
    `;
  }

  const table = el('findings-table');
  if (table) {
    if (!findingsAvailable) {
      table.innerHTML = `<div class="empty">Neither canonical Core findings nor the optional dashboard <code>findings</code> table are available yet. Connect Core or restore the dashboard table to populate this queue.</div>`;
    } else if (!findings.length) {
      table.innerHTML = `<div class="empty">No findings yet. Canonical Core records and dashboard operational findings will appear here with severity, correlation, and next actions.</div>`;
    } else {
      table.innerHTML = `
        ${renderAiDependencyGuardSurface(findings)}
        <div class="table-wrap"><table class="mobile-card-table">
          <thead><tr><th>Finding</th><th>Severity</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${findings.map(f => {
            const related = relatedTasksForFinding(f);
            const normalizedFindingId = findingId(f);
            const selected = String(state.selectedFindingId) === String(normalizedFindingId);
            return `<tr class="finding-row ${selected ? 'selected-row' : ''}" data-finding-id="${escapeHtml(normalizedFindingId || '')}">
              <td data-label="Finding"><strong>${escapeHtml(findingTitle(f))}</strong><span class="finding-origin ${findingRecordOrigin(f)}">${findingRecordOrigin(f) === 'core' ? 'Core canonical' : 'Dashboard'}</span><div class="small">${escapeHtml(displayFindingSource(f))}${findingConfidence(f) !== null ? ` • confidence ${escapeHtml(findingConfidence(f))}` : ''}</div><div class="small">${escapeHtml(compactText(findingBody(f), 120))}</div></td>
              <td data-label="Severity"><span class="badge priority-${String(findingSeverity(f)).toLowerCase() === 'critical' ? 'urgent' : String(findingSeverity(f)).toLowerCase() === 'high' ? 'high' : 'normal'}">${escapeHtml(findingSeverity(f))}</span></td>
              <td data-label="Status">${renderStatusPill(String(effectiveFindingStatus(f)).toLowerCase(), humanizeSnake(effectiveFindingStatus(f)))}</td>
              <td data-label="Actions"><div class="task-card-actions finding-actions"><button class="primary-btn mini-btn finding-select-btn" data-finding-id="${escapeHtml(normalizedFindingId || '')}">Review</button><details class="inline-action-menu"><summary>More</summary><div><button class="mini-btn finding-task-btn" data-finding-id="${escapeHtml(normalizedFindingId || '')}">Create task</button><button class="mini-btn finding-run-investigate-btn" data-finding-id="${escapeHtml(normalizedFindingId || '')}">Start investigation</button></div></details></div></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`;
      table.querySelectorAll('.finding-task-btn').forEach(btn => btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const finding = findings.find(f => String(findingId(f)) === String(btn.dataset.findingId));
        if (finding) openFindingTaskModal(finding);
      }));
      table.querySelectorAll('.finding-run-investigate-btn').forEach(btn => btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const finding = findings.find(f => String(findingId(f)) === String(btn.dataset.findingId));
        if (!finding) return;
        try {
          await runNativeInvestigate(finding);
        } catch (err) {
          console.error('native investigate failed', err);
          setStatus(err.message || String(err), true);
        }
      }));
      table.querySelectorAll('.finding-copy-investigate-btn').forEach(btn => btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const finding = findings.find(f => String(findingId(f)) === String(btn.dataset.findingId));
        if (finding) await copyTextWithStatus(investigateFindingCommand(finding), `Investigate command copied for ${findingTitle(finding)}`);
      }));
      table.querySelectorAll('.finding-select-btn, .finding-row').forEach(row => row.addEventListener('click', (event) => {
        const target = event.target.closest('[data-finding-id]');
        if (!target) return;
        selectFinding(target.dataset.findingId);
        renderFindings();
      }));
    }
  }

  const intel = el('intel-summary');
  if (intel) {
    const selected = currentSelectedFinding();
    if (selected) {
      const selectedId = String(findingId(selected) || '');
      const existingDisposition = el('selected-finding-close-disposition')?.value;
      const existingNote = el('selected-finding-close-note')?.value;
      if (selectedId && (existingDisposition !== undefined || existingNote !== undefined)) {
        state.nativeCloseDraft = {
          findingId: selectedId,
          disposition: existingDisposition || state.nativeCloseDraft?.disposition || 'needs_review',
          note: existingNote ?? state.nativeCloseDraft?.note ?? ''
        };
      }
    }
    if (!findingsAvailable) {
      intel.innerHTML = triageLatest ? `
        <div class="card finding-detail-card">
          <h4>Native triage overview</h4>
          <div class="kv-list">
            <div class="kv-row"><div class="kv-key">Open findings</div><div class="kv-val">${escapeHtml(triageSummary?.open_findings ?? '—')}</div></div>
            <div class="kv-row"><div class="kv-key">In review</div><div class="kv-val">${escapeHtml(triageSummary?.in_review_findings ?? '—')}</div></div>
            <div class="kv-row"><div class="kv-key">Pending actions</div><div class="kv-val">${escapeHtml(triageSummary?.pending_actions ?? pendingActions.length)}</div></div>
            <div class="kv-row"><div class="kv-key">Latest orchestrator run</div><div class="kv-val">${escapeHtml(fmtDate(triageLatest.generated_at))}</div></div>
          </div>
          <div class="small" style="margin-top:12px;">Supabase findings are not available yet. The dashboard is falling back to local SecOpsAI triage state via the helper API.</div>
        </div>
      ` : `<div class="empty">Correlation detail will appear here once the optional <code>findings</code> table exists.</div>`;
      return;
    }
    if (!selected) {
      intel.innerHTML = triageLatest ? `
        <div class="card finding-detail-card">
          <h4>Native triage overview</h4>
          <div class="kv-list">
            <div class="kv-row"><div class="kv-key">Open findings</div><div class="kv-val">${escapeHtml(triageSummary?.open_findings ?? '—')}</div></div>
            <div class="kv-row"><div class="kv-key">Pending actions</div><div class="kv-val">${escapeHtml(triageSummary?.pending_actions ?? pendingActions.length)}</div></div>
            <div class="kv-row"><div class="kv-key">Applied actions</div><div class="kv-val">${escapeHtml(triageSummary?.applied_actions ?? localAppliedActionsCount())}</div></div>
            <div class="kv-row"><div class="kv-key">Latest orchestrator run</div><div class="kv-val">${escapeHtml(fmtDate(triageLatest.generated_at))}</div></div>
          </div>
          ${pendingActions.length ? `<div class="small" style="margin-top:12px;"><strong>Pending actions:</strong> ${escapeHtml(pendingActions.slice(0, 3).map(item => `${item.action_id}: ${item.summary || item.action_type}`).join(' • '))}</div>` : ''}
          <div class="small" style="margin-top:12px;">Select a finding to inspect correlation, related requests, and native SecOpsAI triage context.</div>
        </div>
      ` : `<div class="empty">Select a finding to inspect correlation, related requests, and suggested next actions.</div>`;
      return;
    }
    const related = relatedTasksForFinding(selected);
    const closeDraft = state.nativeCloseDraft && String(state.nativeCloseDraft.findingId) === String(findingId(selected) || '')
      ? state.nativeCloseDraft
      : { disposition: 'needs_review', note: '' };
    const requests = correlatedRunRequestsForFinding(selected);
    const nativeInsight = localFindingInsight(findingId(selected));
    const findingSessions = sessionsForFinding(selected);
    const latestSession = findingSessions[0] || null;
    const sessionApprovals = pendingApprovalsForSession(latestSession);
    const disposition = String(effectiveFindingDisposition(selected) || 'unreviewed').toLowerCase();
    const explicitAssessment = findingValue(selected, 'maliciousness_verdict') || findingValue(selected, 'assessment') || findingValue(selected, 'assessment_label');
    const assessment = String(explicitAssessment || (!['unreviewed', 'needs_review', 'pending', 'unknown', ''].includes(disposition) ? disposition : 'unconfirmed_static_lead'));
    const rawConfidence = findingConfidence(selected);
    const numericConfidence = Number(rawConfidence);
    const confidenceLabel = rawConfidence === null || rawConfidence === undefined || rawConfidence === ''
      ? 'Not recorded'
      : (Number.isFinite(numericConfidence) ? `${numericConfidence <= 1 ? Math.round(numericConfidence * 100) : Math.round(numericConfidence)}%` : String(rawConfidence));
    const rawLocalExposure = findingValue(selected, 'local_exposure') || findingValue(selected, 'environment_impact') || findingValue(selected, 'local_usage') || 'unknown';
    const localExposure = typeof rawLocalExposure === 'object' ? (rawLocalExposure.status || rawLocalExposure.verdict || 'unknown') : rawLocalExposure;
    const confirmedFacts = [
      `Detected by ${displayFindingSource(selected)}.`,
      `Recorded ${fmtDate(findingDetectedAt(selected))}.`,
      findingFingerprint(selected) ? `Indicator: ${findingFingerprint(selected)}.` : ''
    ].filter(Boolean);
    const evidenceGaps = [
      assessment === 'unconfirmed_static_lead' ? 'Maliciousness has not been confirmed.' : '',
      String(localExposure).toLowerCase() === 'unknown' ? 'Local exposure has not been established.' : '',
      confidenceLabel === 'Not recorded' ? 'Detection confidence is not recorded.' : '',
      !latestSession ? 'No guarded investigation session has started.' : ''
    ].filter(Boolean);
    const recommendedAction = latestSession
      ? 'Review the active investigation and resolve its first missing evidence item.'
      : 'Start a guarded investigation before closing, escalating, or creating research.';
    intel.innerHTML = `
      <div class="finding-detail-header">
        <div>
          <div class="detail-eyebrow">Finding detail</div>
          <h4>${escapeHtml(findingTitle(selected))}</h4>
          <div class="finding-meta-line">
            <span>${escapeHtml(displayFindingSource(selected))}</span>
            <span>${escapeHtml(fmtDate(findingDetectedAt(selected)))}</span>
            ${findingFingerprint(selected) ? `<span>${escapeHtml(findingFingerprint(selected))}</span>` : ''}
          </div>
        </div>
        <div class="detail-status-stack">
          <div class="small muted-inline">Current status</div>
          ${renderStatusPill(String(effectiveFindingStatus(selected)).toLowerCase(), humanizeSnake(effectiveFindingStatus(selected)))}
        </div>
      </div>
      <section class="finding-decision-summary" aria-label="Finding decision summary">
        <div class="finding-decision-head">
          <div><span class="eyebrow">Current assessment</span><h4>${escapeHtml(humanizeSnake(assessment))}</h4><p>${escapeHtml(findingBody(selected) || 'A finding was recorded, but no additional narrative is available.')}</p></div>
          <span class="decision-card-badge">${escapeHtml(humanizeSnake(effectiveFindingStatus(selected)))}</span>
        </div>
        <div class="finding-assessment-grid">
          <div><span>Investigation priority</span><strong>${escapeHtml(humanizeSnake(findingSeverity(selected)))}</strong></div>
          <div><span>Detection confidence</span><strong>${escapeHtml(confidenceLabel)}</strong></div>
          <div><span>Maliciousness</span><strong>${escapeHtml(humanizeSnake(assessment))}</strong></div>
          <div><span>Local exposure</span><strong>${escapeHtml(humanizeSnake(String(localExposure)))}</strong></div>
        </div>
        <div class="finding-decision-columns">
          <div><h5>Confirmed facts</h5><ul>${confirmedFacts.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>
          <div><h5>Evidence gaps</h5>${evidenceGaps.length ? `<ul>${evidenceGaps.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>No immediate evidence gap is recorded. Verify the full evidence before deciding.</p>'}</div>
        </div>
        <div class="finding-recommended-action"><span><strong>Recommended next action</strong>${escapeHtml(recommendedAction)}</span><div><button class="primary-btn" id="finding-decision-investigate-btn" type="button">${latestSession ? 'Open investigation' : 'Start investigation'}</button><button class="secondary-btn" id="finding-decision-research-btn" type="button">Run source-backed research</button><button class="secondary-btn" id="finding-decision-task-btn" type="button">Create task</button></div></div>
      </section>
      <details class="finding-full-evidence">
        <summary>Open supporting evidence and protected actions</summary>
        <div class="finding-full-evidence-body">
      <div class="finding-detail-grid">
        <div class="card finding-detail-card">
          <h4>Finding overview</h4>
          <div class="kv-list">
            <div class="kv-row"><div class="kv-key">Severity</div><div class="kv-val">${escapeHtml(findingSeverity(selected))}</div></div>
            <div class="kv-row"><div class="kv-key">Confidence</div><div class="kv-val">${escapeHtml(findingConfidence(selected) ?? '—')}</div></div>
            <div class="kv-row"><div class="kv-key">Disposition</div><div class="kv-val">${escapeHtml(humanizeSnake(effectiveFindingDisposition(selected)))}</div></div>
            <div class="kv-row"><div class="kv-key">Record owner</div><div class="kv-val">${findingRecordOrigin(selected) === 'core' ? 'SecOpsAI Core (canonical)' : 'Dashboard operations'}</div></div>
            <div class="kv-row"><div class="kv-key">Suggested domain</div><div class="kv-val">${escapeHtml(findingDomainHint(selected))}</div></div>
          </div>
          <div class="detail-summary">${escapeHtml(findingBody(selected) || 'No additional finding narrative available.')}</div>
        </div>
        <div class="card finding-detail-card">
          <h4>Related tasks</h4>
          ${related.length ? related.map(match => `<div class="feed-item compact-feed-item"><div><strong>${escapeHtml(match.item.title)}</strong></div><div class="small">${escapeHtml(humanizeSnake(match.item.status || 'unknown'))} • score ${match.score}</div><div class="small">${escapeHtml(compactText(match.reasons.join(' • '), 140))}</div></div>`).join('') : '<div class="empty">No convincing task match yet. Create a dedicated investigation task.</div>'}
        </div>
      </div>
      ${renderAiDependencyGuardDetail(selected)}
      <div class="card finding-detail-card" style="margin-top:14px;">
        <h4>Native SecOpsAI triage</h4>
        ${nativeInsight ? `
          <div class="kv-list">
            ${nativeInsight.orchestratorFinding ? `<div class="kv-row"><div class="kv-key">Recommended disposition</div><div class="kv-val">${escapeHtml(humanizeSnake(nativeInsight.orchestratorFinding.recommended_disposition || '—'))}</div></div>` : ''}
            ${nativeInsight.orchestratorFinding ? `<div class="kv-row"><div class="kv-key">Latest outcome</div><div class="kv-val">${escapeHtml(humanizeSnake(nativeInsight.orchestratorFinding.outcome || '—'))}</div></div>` : ''}
            ${nativeInsight.orchestratorFinding ? `<div class="kv-row"><div class="kv-key">Confidence</div><div class="kv-val">${escapeHtml(humanizeSnake(nativeInsight.orchestratorFinding.confidence ?? '—'))}</div></div>` : ''}
            ${nativeInsight.pendingAction ? `<div class="kv-row"><div class="kv-key">Pending action</div><div class="kv-val">${escapeHtml(nativeInsight.pendingAction.action_id || humanizeSnake(nativeInsight.pendingAction.action_type || '—'))}</div></div>` : ''}
          </div>
          <div class="detail-summary">${escapeHtml(nativeInsight.pendingAction?.summary || nativeInsight.orchestratorFinding?.summary || 'Native triage context available.')}</div>
        ` : `
          <div class="empty compact-empty">No direct triage insight was found for this finding yet. You can still investigate it now or close it with a guarded disposition after review.</div>
          ${triageLatest ? `<div class="small" style="margin-top:10px;">Latest orchestrator run: ${escapeHtml(fmtDate(triageLatest.generated_at))} • processed ${escapeHtml(triageLatest.processed ?? '—')} findings</div>` : ''}
        `}
        ${latestSession ? `
          <div class="card" style="margin-top:14px; background:rgba(8,13,26,0.72);">
            <h4>Investigation session</h4>
            <div class="kv-list">
              <div class="kv-row"><div class="kv-key">Session</div><div class="kv-val">${escapeHtml(latestSession.session_id)}</div></div>
              <div class="kv-row"><div class="kv-key">Status</div><div class="kv-val">${escapeHtml(humanizeSnake(latestSession.status || 'open'))}</div></div>
              <div class="kv-row"><div class="kv-key">Progress</div><div class="kv-val">${escapeHtml(sessionProgressLabel(latestSession))}</div></div>
              <div class="kv-row"><div class="kv-key">Approvals pending</div><div class="kv-val">${escapeHtml(String(latestSession.pending_approvals || 0))}</div></div>
              <div class="kv-row"><div class="kv-key">Artifacts</div><div class="kv-val">${escapeHtml(String(latestSession.artifact_count || 0))}</div></div>
              <div class="kv-row"><div class="kv-key">Updated</div><div class="kv-val">${escapeHtml(fmtDate(latestSession.updated_at))}</div></div>
            </div>
            <div class="detail-summary">${escapeHtml(latestSession.latest_event?.message || latestSession.title || 'Session context available.')}</div>
            <div class="task-card-actions" style="margin-top:12px;">
              <button class="mini-btn" id="selected-finding-copy-session-btn">Copy session show</button>
              <button class="mini-btn" id="selected-finding-open-session-btn">Open in Native Triage</button>
              <button class="mini-btn" id="selected-finding-run-research-btn">Run source-backed research</button>
            </div>
            ${sessionApprovals.length ? `
              <div class="small" style="margin-top:12px;"><strong>Pending approvals</strong></div>
              <div style="margin-top:10px;">
                ${sessionApprovals.slice(0, 3).map(approval => `
                  <div class="feed-item compact-feed-item">
                    <div><strong>${escapeHtml(approval.approval_id || 'approval')}</strong> • ${escapeHtml(humanizeSnake(approval.type || 'pending'))}</div>
                    <div class="small">${escapeHtml(compactText(approval.summary || 'Approval waiting for review.', 180))}</div>
                    <div class="task-card-actions" style="margin-top:10px;">
                      <button class="mini-btn session-approval-approve-btn" data-session-id="${escapeHtml(latestSession.session_id || '')}" data-approval-id="${escapeHtml(approval.approval_id || '')}">Approve & apply</button>
                      <button class="mini-btn session-approval-reject-btn" data-session-id="${escapeHtml(latestSession.session_id || '')}" data-approval-id="${escapeHtml(approval.approval_id || '')}">Reject</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        ` : ''}
        ${String(effectiveFindingStatus(selected)).toLowerCase() !== 'closed' ? `
          <div class="native-close-panel">
            <div class="form-grid native-close-grid">
              <label>
                <span>Close disposition</span>
                <select id="selected-finding-close-disposition">
                  <option value="needs_review" ${closeDraft.disposition === 'needs_review' ? 'selected' : ''}>Needs Review</option>
                  <option value="tune_policy" ${closeDraft.disposition === 'tune_policy' ? 'selected' : ''}>Tune Policy</option>
                  <option value="expected_behavior" ${closeDraft.disposition === 'expected_behavior' ? 'selected' : ''}>Expected Behavior</option>
                  <option value="false_positive" ${closeDraft.disposition === 'false_positive' ? 'selected' : ''}>False Positive</option>
                </select>
              </label>
              <label class="full">
                <span>Analyst note</span>
                <textarea id="selected-finding-close-note" rows="3" placeholder="Explain why this finding should be closed in native SecOpsAI.">${escapeHtml(closeDraft.note || '')}</textarea>
              </label>
            </div>
            <div class="task-card-actions" style="margin-top:14px;">
              <button class="mini-btn" id="selected-finding-run-close-btn">Close in SecOpsAI</button>
            </div>
            <div class="small" style="margin-top:10px;">Only guarded dispositions are available here. Sensitive dispositions require the approved investigation workflow.</div>
          </div>
        ` : `
          <div class="small" style="margin-top:12px;">This finding is already marked closed locally in the current dashboard session.</div>
        `}
      </div>
      <div class="card finding-detail-card" style="margin-top:14px;">
        <h4>Run context</h4>
        ${requests.length ? requests.map(match => `<div class="feed-item compact-feed-item"><div><strong>${escapeHtml(shortRoleLabel(match.request.role_label || 'unknown'))}</strong></div><div class="small">${escapeHtml(humanizeSnake(match.request.status || 'queued'))} • score ${match.score}</div><div class="small">${escapeHtml(summarizePromptText(match.request.prompt_text || '—'))}</div></div>`).join('') : '<div class="empty compact-empty">No strong queued-run overlap yet. This stays empty when the local run queue does not meaningfully reference the finding.</div>'}
        <div class="action-cluster">
          <div class="small action-cluster-label">Next actions</div>
          <div class="task-card-actions" style="margin-top:10px;"><button class="mini-btn" id="selected-finding-run-investigate-btn">Start investigation</button>${!latestSession ? `<button class="mini-btn" id="selected-finding-run-research-btn">Run source-backed research</button>` : ''}${nativeInsight?.pendingAction ? `<button class="mini-btn" id="selected-finding-run-apply-btn">Apply approved action</button>` : ''}<button class="mini-btn" id="selected-finding-task-btn">Create investigation task</button>${related[0]?.item ? `<button class="mini-btn" id="selected-finding-prompt-btn">Open lead brief</button>` : ''}</div>
        </div>
      </div>
        </div>
      </details>
    `;
    el('finding-decision-task-btn')?.addEventListener('click', () => openFindingTaskModal(selected));
    el('finding-decision-investigate-btn')?.addEventListener('click', async () => {
      if (latestSession?.session_id) {
        await selectNativeSession(latestSession.session_id, { focusFinding: false });
        setPage('integrations', { routeOverride: 'system/audit' });
        return;
      }
      try {
        await runNativeInvestigate(selected);
      } catch (err) {
        console.error('native investigate failed', err);
        setStatus(err.message || String(err), true);
      }
    });
    el('finding-decision-research-btn')?.addEventListener('click', async () => {
      try {
        await runNativeResearchFinding(selected);
      } catch (err) {
        console.error('native research failed', err);
        setStatus(err.message || String(err), true);
      }
    });
    el('selected-finding-task-btn')?.addEventListener('click', () => openFindingTaskModal(selected));
    el('selected-finding-prompt-btn')?.addEventListener('click', () => {
      const top = related[0]?.item;
      if (top) openPromptModal(top);
    });
    el('selected-finding-run-investigate-btn')?.addEventListener('click', async () => {
      try {
        await runNativeInvestigate(selected);
      } catch (err) {
        console.error('native investigate failed', err);
        setStatus(err.message || String(err), true);
      }
    });
    el('selected-finding-copy-investigate-btn')?.addEventListener('click', () => copyTextWithStatus(investigateFindingCommand(selected), `Investigate command copied for ${findingTitle(selected)}`));
    el('selected-finding-copy-session-btn')?.addEventListener('click', () => copyTextWithStatus(sessionShowCommand(latestSession), `Session command copied for ${findingTitle(selected)}`));
    el('selected-finding-open-session-btn')?.addEventListener('click', async () => {
      if (latestSession?.session_id) {
        await selectNativeSession(latestSession.session_id, { focusFinding: false });
        setPage('integrations');
      }
    });
    el('selected-finding-run-research-btn')?.addEventListener('click', async () => {
      try {
        await runNativeResearchFinding(selected);
      } catch (err) {
        console.error('native research failed', err);
        setStatus(err.message || String(err), true);
      }
    });
    el('selected-finding-copy-research-btn')?.addEventListener('click', () => copyTextWithStatus(researchFindingCommand(selected), `Research command copied for ${findingTitle(selected)}`));
    el('selected-finding-run-apply-btn')?.addEventListener('click', async () => {
      try {
        await runNativeApplyAction(nativeInsight?.pendingAction);
      } catch (err) {
        console.error('native apply-action failed', err);
        setStatus(err.message || String(err), true);
      }
    });
    el('selected-finding-copy-apply-btn')?.addEventListener('click', () => copyTextWithStatus(nativeActionCommand(nativeInsight?.pendingAction), `Apply-action command copied for ${findingTitle(selected)}`));
    el('selected-finding-run-close-btn')?.addEventListener('click', async () => {
      const disposition = el('selected-finding-close-disposition')?.value || 'needs_review';
      const note = el('selected-finding-close-note')?.value || '';
      try {
        await runNativeCloseFinding(selected, disposition, note, 'closed');
      } catch (err) {
        console.error('native close failed', err);
        setStatus(err.message || String(err), true);
      }
    });
    el('selected-finding-copy-close-btn')?.addEventListener('click', () => {
      const disposition = el('selected-finding-close-disposition')?.value || 'needs_review';
      const note = el('selected-finding-close-note')?.value || 'Analyst review note required.';
      copyTextWithStatus(closeFindingCommand(selected, disposition, note), `Close command copied for ${findingTitle(selected)}`);
    });
    el('selected-finding-close-disposition')?.addEventListener('change', event => {
      state.nativeCloseDraft = { findingId: String(findingId(selected) || ''), disposition: event.currentTarget.value, note: el('selected-finding-close-note')?.value || '' };
    });
    el('selected-finding-close-note')?.addEventListener('input', event => {
      state.nativeCloseDraft = { findingId: String(findingId(selected) || ''), disposition: el('selected-finding-close-disposition')?.value || 'needs_review', note: event.currentTarget.value };
    });
    intel.querySelectorAll('.session-approval-approve-btn').forEach(btn => btn.addEventListener('click', async () => {
      try {
        await runNativeResolveApproval(btn.dataset.sessionId, btn.dataset.approvalId, { decision: 'approved', apply: true });
      } catch (err) {
        console.error('native approval resolve failed', err);
        setStatus(err.message || String(err), true);
      }
    }));
    intel.querySelectorAll('.session-approval-reject-btn').forEach(btn => btn.addEventListener('click', async () => {
      try {
        await runNativeResolveApproval(btn.dataset.sessionId, btn.dataset.approvalId, { decision: 'rejected', apply: false });
      } catch (err) {
        console.error('native approval reject failed', err);
        setStatus(err.message || String(err), true);
      }
    }));
  }
}


function humanizeSnake(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function shortRoleLabel(role) {
  const text = String(role || '').trim();
  if (!text) return '';
  const parts = text.split('/');
  return parts[parts.length - 1] || text;
}

function compactText(value, max = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '—';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function summarizePromptText(prompt) {
  const text = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!text) return '—';
  if (/SYSTEM \/ ORCHESTRATOR HANDOFF/i.test(text)) return 'Structured orchestrator handoff prompt';
  if (/Prepare work for/i.test(text)) return compactText(text, 100);
  return compactText(text, 100);
}

function tryParseJsonBlob(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function stripAnsi(value) {
  return String(value || '').replace(/\[[0-9;]*m/g, ' ');
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function relatedRunForRequest(req) {
  if (!req?.related_run_id) return null;
  return state.runs.find(run => String(run.id) === String(req.related_run_id)) || null;
}

function deriveSuggestedReviewer(item = {}, fallbackReviewer = '') {
  const existing = String(fallbackReviewer || item?.reviewer_role || '').trim();
  if (existing) return existing;
  if (item?.requires_security_review) return 'security/security-engineer';
  if (item?.external_facing) return 'exec/agents-orchestrator';
  const domain = String(item?.domain || '').toLowerCase();
  if (domain === 'security') return 'exec/agents-orchestrator';
  if (domain === 'platform') return 'security/security-engineer';
  if (domain === 'exec') return 'security/security-engineer';
  return 'security/security-engineer';
}

function collectRunRequestText(req, run = null) {
  return stripAnsi([
    req?.output_summary,
    req?.error,
    req?.result_text,
    req?.stdout,
    req?.stderr,
    run?.output_summary,
    run?.task_summary,
    run?.task_detail,
    run?.stdout,
    run?.stderr,
    run?.result_text,
    req?.fetched_output_text,
    run?.fetched_output_text
  ].filter(Boolean).join('\n'));
}

function normalizeEvidenceText(value) {
  return stripAnsi(String(value || ''))
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeUuidContext(text, index, token) {
  const start = Math.max(0, index - 16);
  const end = Math.min(text.length, index + token.length + 16);
  const around = text.slice(start, end);
  return /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(around);
}

function extractCommitEvidence(text) {
  const normalized = normalizeEvidenceText(text);
  if (!normalized) return '';
  const urlMatch = normalized.match(/https?:\/\/github\.com\/[^\s)]+\/commit\/([a-f0-9]{7,40})\b/i);
  if (urlMatch) return urlMatch[1];

  const labeledLine = normalized.match(/(?:^|\n)(?:[-*]\s*)?(?:commit(?:\s+exists)?|commit\s+hash|commit id|commit oid|commit sha|sha(?:1)?|revision|head commit|new commit|created commit)\s*[:\-=]\s*`?([a-f0-9]{7,40})`?/i);
  if (labeledLine && labeledLine[1]) return labeledLine[1];

  const inlineMatch = normalized.match(/(?:\bcommit(?:ted)?\b[^\n]{0,80}?\b(?:as|at|to|is)?\s*`?([a-f0-9]{7,40})`?)|(?:\b([a-f0-9]{7,40})\b[^\n]{0,60}?\bcommit\b)/i);
  if (inlineMatch) return inlineMatch[1] || inlineMatch[2] || '';

  const gitStyleMatch = normalized.match(/\b[0-9]+\s+files? changed[\s\S]{0,160}?\b([a-f0-9]{7,40})\b/i)
    || normalized.match(/(?:^|\n)([a-f0-9]{7,40})\s+-\s+/i)
    || normalized.match(/(?:^|\n)\s*\*\s*([a-f0-9]{7,40})\b/i);
  if (gitStyleMatch) return gitStyleMatch[1];

  const regex = /\b([a-f0-9]{7,40})\b/ig;
  let match;
  while ((match = regex.exec(normalized))) {
    const token = match[1];
    const idx = match.index;
    if (looksLikeUuidContext(normalized, idx, token)) continue;
    const before = normalized.slice(Math.max(0, idx - 72), idx);
    const after = normalized.slice(idx + token.length, Math.min(normalized.length, idx + token.length + 96));
    if (/-$/.test(before) || /^-/.test(after)) continue;
    const context = `${before}${token}${after}`;
    if (/(?:\bcommit(?:ted)?\b|\bsha(?:1)?\b|\brevision\b|\bhash\b|\bhead\b|\boid\b|\bcherry-pick\b)/i.test(context)) return token;
  }
  return '';
}

function extractPrEvidence(text) {
  const normalized = normalizeEvidenceText(text);
  if (!normalized) return { prUrl: '', prNumber: '' };
  const prUrlMatch = normalized.match(/https?:\/\/github\.com\/[^\s)]+\/pull\/(\d+)\b/i);
  if (prUrlMatch) return { prUrl: prUrlMatch[0], prNumber: prUrlMatch[1] };
  const prNumberMatch = normalized.match(/(?:\bPR\s*#|\bpull request\s*#?)(\d+)\b/i);
  return { prUrl: '', prNumber: prNumberMatch ? prNumberMatch[1] : '' };
}

function extractFilesChangedEvidence(text) {
  const normalized = normalizeEvidenceText(text);
  if (!normalized) return '';
  const changedMatch = normalized.match(/(?:files? changed|changed files?)\s*[:\-]?\s*(\d{1,4})\b/i)
    || normalized.match(/(\d{1,4})\s+files? changed\b/i)
    || normalized.match(/\bmodified\s+(\d{1,4})\s+files?\b/i);
  if (changedMatch) return changedMatch[1];
  const fileLineCount = normalized.split('\n').filter(line => /(?:^|\s)(?:[\w.-]+\/)*[\w.-]+\.(?:js|ts|tsx|jsx|py|md|json|sql|css|html)\b/.test(line)).length;
  return fileLineCount >= 2 ? String(fileLineCount) : '';
}

function extractHumanResultSummary(...values) {
  for (const value of values) {
    if (!value) continue;
    const parsed = tryParseJsonBlob(value);
    if (parsed) {
      const summary = firstNonEmpty(
        parsed?.result?.headline,
        parsed?.result?.summary,
        parsed?.summary,
        parsed?.excerpt,
        parsed?.stdout_excerpt,
        parsed?.stderr_excerpt
      );
      if (summary) return compactText(stripAnsi(summary), 220);
    }
    const normalized = normalizeEvidenceText(value);
    if (!normalized) continue;
    const summaryMatch = normalized.match(/(?:^|\n)(?:summary|result|outcome|headline)\s*[:\-]\s*([^\n]{12,240})/i);
    if (summaryMatch?.[1]) return compactText(summaryMatch[1].trim(), 220);
    const meaningfulLine = normalized.split('\n').map(line => line.trim()).find(line => {
      if (!line) return false;
      if (/^[\[{]/.test(line)) return false;
      if (/^(executor|returncode|aborted|partial|timed_out|prompt_chars|ok|command)\b/i.test(line)) return false;
      return true;
    });
    if (meaningfulLine) return compactText(meaningfulLine, 220);
  }
  return '';
}

function hasImplementationSignals(text) {
  const normalized = normalizeEvidenceText(text).toLowerCase();
  if (!normalized) return false;
  if (extractCommitEvidence(normalized)) return true;
  const prEvidence = extractPrEvidence(normalized);
  if (prEvidence.prUrl || prEvidence.prNumber) return true;
  if (extractFilesChangedEvidence(normalized)) return true;
  return [
    /\bimplemented\b/, /\bfixed\b/, /\bpatched\b/, /\bupdated\b/, /\bchanged\b/, /\bmodified\b/,
    /\bcreated\b/, /\badded\b/, /\brefactored\b/, /\bedited\b/, /\bwrote\b/,
    /\b(?:app|index|styles|config|dispatcher|server)\.(?:js|py|css|html|md|sql)\b/
  ].some(rx => rx.test(normalized));
}

function hasAnalysisOnlySignals(text) {
  const normalized = normalizeEvidenceText(text).toLowerCase();
  if (!normalized) return false;
  return [
    /\banalysis\b/, /\binvestigated\b/, /\brecommend(?:ation|ed)?\b/, /\bsuggest(?:ion|ed)?\b/,
    /\bnext steps\b/, /\bplan\b/, /\bwould\b/, /\bcould\b/, /\bshould\b/,
    /\bno changes made\b/, /\bnot implemented\b/, /\bno implementation\b/
  ].some(rx => rx.test(normalized));
}

function parseRunRequestArtifacts(req, run = null) {
  const text = collectRunRequestText(req, run);
  const prEvidence = extractPrEvidence(text);
  return {
    commit: firstNonEmpty(extractCommitEvidence(text), req?.commit_hash, run?.commit_hash),
    prUrl: firstNonEmpty(prEvidence.prUrl, req?.pr_url, run?.pr_url),
    prNumber: firstNonEmpty(prEvidence.prNumber, req?.pr_number, run?.pr_number),
    filesChanged: firstNonEmpty(extractFilesChangedEvidence(text), req?.files_changed, run?.files_changed),
    summary: extractHumanResultSummary(req?.output_summary, run?.output_summary, req?.error, req?.result_text, run?.task_summary)
  };
}

function runRequestWorkerIdentity(req, run = null) {
  return firstNonEmpty(
    req?.worker_identity,
    req?.worker_name,
    req?.agent_identity,
    req?.agent_name,
    req?.picked_up_by,
    run?.initiated_by,
    run?.model_used ? `${run.model_used}${run.runtime ? ` via ${run.runtime}` : ''}` : '',
    run?.role_label
  );
}

function latestRunRequestForTask(taskId) {
  if (!taskId) return null;
  return state.runRequests
    .filter(r => String(r.related_work_item_id || '') === String(taskId))
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))[0] || null;
}

function runRequestLifecycle(req, run = null) {
  const rawStatus = String(req?.status || run?.status || '').toLowerCase();
  const parsedOutput = tryParseJsonBlob(req?.output_summary) || tryParseJsonBlob(run?.output_summary);
  const aborted = !!parsedOutput?.result?.meta?.aborted;
  const outcomeText = collectRunRequestText(req, run).toLowerCase();
  const artifacts = parseRunRequestArtifacts(req, run);
  const implementationLikely = hasImplementationSignals(outcomeText) || !!artifacts.commit || !!artifacts.prUrl || !!artifacts.prNumber || !!artifacts.filesChanged;
  const analysisOnly = hasAnalysisOnlySignals(outcomeText) && !implementationLikely;
  const badPatterns = [
    /i can't fulfil/, /i can't fulfill/, /cannot fulfill/, /can't comply/, /cannot comply/,
    /i can.t help with that/, /i can.t assist with that/, /refus/, /unable to complete/,
    /could not complete/, /blocked/, /need[s]? review/, /not enough context/,
    /waiting on/, /missing access/, /requires approval/, /incomplete/, /partial/
  ];
  const hasBadOutcome = badPatterns.some(rx => rx.test(outcomeText));
  const hasPositiveEvidence = implementationLikely || [/completed successfully/, /done\b/, /finished\b/].some(rx => rx.test(outcomeText));

  let displayStatus = rawStatus || 'queued';
  let displayLabel = humanizeSnake(displayStatus);
  let outcomeHint = '';

  if (rawStatus === 'queued' && (run?.started_at || req?.started_at || req?.picked_up_at)) {
    displayStatus = 'picked_up';
    displayLabel = 'Picked Up';
  } else if (rawStatus === 'running' && (req?.picked_up_at || run?.started_at)) {
    displayStatus = 'running';
    displayLabel = 'Running';
  } else if (rawStatus === 'completed' && hasBadOutcome) {
    displayStatus = 'needs_review';
    displayLabel = 'Needs Review';
    outcomeHint = 'Marked completed, but the output reads like a refusal, blocker, missing access, or incomplete delivery.';
  } else if (rawStatus === 'completed' && aborted) {
    displayStatus = 'completed_with_gaps';
    displayLabel = 'Completed (low proof)';
    outcomeHint = 'The recorded output shows the worker was aborted before clean delivery.';
  } else if (rawStatus === 'completed' && analysisOnly) {
    displayStatus = 'completed_with_gaps';
    displayLabel = 'Completed (analysis only)';
    outcomeHint = 'The worker appears to have analyzed or planned work, but did not clearly report implemented changes.';
  } else if (rawStatus === 'completed' && !hasPositiveEvidence) {
    displayStatus = 'completed_with_gaps';
    displayLabel = 'Completed (low proof)';
    outcomeHint = 'Completed with limited implementation proof. Check files changed, output path, or related run details.';
  } else if (rawStatus === 'completed') {
    outcomeHint = implementationLikely
      ? 'Implementation evidence found in the output summary or related run metadata.'
      : 'Completion evidence found, but file-level implementation proof is still thin.';
  }

  const evidence = [
    req?.created_at ? `Requested ${fmtDate(req.created_at)}` : null,
    (req?.picked_up_at || run?.started_at) ? `Picked up ${fmtDate(req?.picked_up_at || run?.started_at)}` : null,
    req?.updated_at ? `Last update ${fmtDate(req.updated_at)}` : null,
    (req?.completed_at || run?.completed_at) ? `Finished ${fmtDate(req?.completed_at || run?.completed_at)}` : null,
    artifacts.filesChanged ? `${artifacts.filesChanged} file(s) changed reported` : null,
    artifacts.commit ? `Commit evidence: ${artifacts.commit}` : null,
    artifacts.prUrl ? `PR evidence: ${artifacts.prUrl}` : (artifacts.prNumber ? `PR evidence: #${artifacts.prNumber}` : null),
    analysisOnly ? 'Output reads like analysis/progress rather than a confirmed implementation' : null,
    aborted ? 'Output metadata says the worker was aborted' : null
  ].filter(Boolean);

  return { rawStatus, hasBadOutcome, hasPositiveEvidence, implementationLikely, analysisOnly, displayStatus, displayLabel, outcomeHint, evidence };
}

function summarizeRunRequestResult(req, run = null) {
  const summary = extractHumanResultSummary(req?.output_summary, req?.error, run?.output_summary, run?.task_summary);
  if (summary) return summary;
  const text = firstNonEmpty(req?.output_summary, req?.error, run?.output_summary, run?.task_summary);
  if (!text) {
    return req?.status === 'queued' ? 'Waiting for dispatcher / worker pickup' : '—';
  }
  return compactText(stripAnsi(text), 160);
}

function renderRunRequests() {
  const host = el('run-requests-table');
  if (!host) return;
  const pending = localPendingActions();
  const applied = Array.isArray(state.localTriage?.queue?.applied_recent) ? state.localTriage.queue.applied_recent : [];
  if (!pending.length && !applied.length) {
    host.innerHTML = `<div class="empty">No native pending actions right now. When the SecOpsAI orchestrator queues manual-review actions, they will appear here with copyable apply commands.</div>`;
    return;
  }
  host.innerHTML = `
    <div class="table-wrap"><table class="run-requests-grid">
      <thead><tr><th>Status</th><th>Action</th><th>Finding</th><th>Summary</th><th>Apply</th></tr></thead>
      <tbody>${[...pending, ...applied].map(action => `
        <tr>
          <td>${renderStatusPill(String(action.status || 'unknown').toLowerCase(), humanizeSnake(action.status || 'unknown'))}</td>
          <td><strong>${escapeHtml(statusLabel(action.action_type || 'unknown'))}</strong><div class="small">${escapeHtml(action.action_id || '—')}</div></td>
          <td><div class="small">${escapeHtml(action.finding_id || '—')}</div></td>
          <td><div class="small rr-result">${escapeHtml(compactText(action.summary || action.note || 'No action summary available.', 180))}</div></td>
          <td><div class="task-card-actions rr-actions">${action.status === 'pending' ? `<button class="mini-btn native-action-run-btn" data-action-id="${escapeHtml(action.action_id || '')}">Apply now</button><button class="mini-btn native-action-copy-btn" data-command="${escapeHtml(nativeActionCommand(action))}">Copy apply-action</button>` : '<span class="small">Already applied</span>'}</div></td>
        </tr>`).join('')}</tbody>
    </table></div>`;

  host.querySelectorAll('.native-action-run-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = pending.find(item => String(item.action_id || '') === String(btn.dataset.actionId || ''));
      if (!action) return;
      try {
        await runNativeApplyAction(action);
      } catch (err) {
        console.error('native apply-action failed', err);
        setStatus(err.message || String(err), true);
      }
    });
  });
  host.querySelectorAll('.native-action-copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await copyTextWithStatus(btn.dataset.command || '', 'Apply-action command copied');
    });
  });
}

function renderSessionDetail(session) {
  if (!session) {
    return `<div class="empty">Select a session to inspect plan progress, recent events, artifacts, and pending approvals.</div>`;
  }
  const pendingApprovals = pendingApprovalsForSession(session);
  const recentEvents = Array.isArray(session?.events) ? session.events.slice(-6).reverse() : [];
  const artifacts = Array.isArray(session?.artifacts) ? session.artifacts.slice().reverse() : [];
  const plan = Array.isArray(session?.plan) ? session.plan : [];
  const findingIdValue = String(session?.subject?.finding_id || '').trim();
  return `
    <div class="finding-detail-card">
      <div class="finding-detail-header">
        <div>
          <div class="detail-eyebrow">Selected session</div>
          <h4>${escapeHtml(session.title || session.session_id || 'Session')}</h4>
          <div class="finding-meta-line">
            <span>${escapeHtml(session.session_id || '—')}</span>
            <span>${escapeHtml(humanizeSnake(session.status || 'open'))}</span>
            ${findingIdValue ? `<span>${escapeHtml(findingIdValue)}</span>` : ''}
            <span>${escapeHtml(fmtDate(session.updated_at))}</span>
          </div>
        </div>
        <div class="detail-status-stack">
          <div class="small muted-inline">Progress</div>
          ${renderStatusPill(String(session.status || 'open').toLowerCase(), sessionProgressLabel(session))}
        </div>
      </div>
      <div class="finding-detail-grid">
        <div class="card finding-detail-card">
          <h4>Plan</h4>
          ${plan.length ? plan.map(step => `
            <div class="feed-item compact-feed-item">
              <div><strong>${escapeHtml(step.title || step.step_id || 'step')}</strong></div>
              <div class="small">${escapeHtml(humanizeSnake(step.status || 'pending'))} • ${escapeHtml(fmtDate(step.updated_at))}</div>
              ${step.note ? `<div class="small">${escapeHtml(compactText(step.note, 220))}</div>` : ''}
            </div>
          `).join('') : '<div class="empty compact-empty">No plan steps recorded for this session yet.</div>'}
        </div>
        <div class="card finding-detail-card">
          <h4>Pending approvals</h4>
          ${pendingApprovals.length ? pendingApprovals.map(approval => `
            <div class="feed-item compact-feed-item">
              <div><strong>${escapeHtml(approval.approval_id || 'approval')}</strong> • ${escapeHtml(humanizeSnake(approval.type || 'pending'))}</div>
              <div class="small">${escapeHtml(compactText(approval.summary || 'Approval waiting for review.', 220))}</div>
              <div class="task-card-actions" style="margin-top:10px;">
                <button class="mini-btn selected-session-approve-btn" data-session-id="${escapeHtml(session.session_id || '')}" data-approval-id="${escapeHtml(approval.approval_id || '')}">Approve & apply</button>
                <button class="mini-btn selected-session-reject-btn" data-session-id="${escapeHtml(session.session_id || '')}" data-approval-id="${escapeHtml(approval.approval_id || '')}">Reject</button>
              </div>
            </div>
          `).join('') : '<div class="empty compact-empty">No pending approvals in this session.</div>'}
        </div>
      </div>
      <div class="finding-detail-grid" style="margin-top:14px;">
        <div class="card finding-detail-card">
          <h4>Recent events</h4>
          ${recentEvents.length ? recentEvents.map(event => `
            <div class="feed-item compact-feed-item">
              <div><strong>${escapeHtml(humanizeSnake(event.type || 'event'))}</strong></div>
              <div class="small">${escapeHtml(fmtDate(event.ts))}${event.author ? ` • ${escapeHtml(event.author)}` : ''}</div>
              <div class="small">${escapeHtml(compactText(event.message || 'Session event', 220))}</div>
            </div>
          `).join('') : '<div class="empty compact-empty">No session events recorded yet.</div>'}
        </div>
        <div class="card finding-detail-card">
          <h4>Artifacts</h4>
          ${artifacts.length ? artifacts.map(artifact => `
            <div class="feed-item compact-feed-item">
              <div><strong>${escapeHtml(artifact.label || humanizeSnake(artifact.kind || 'artifact'))}</strong></div>
              <div class="small">${escapeHtml(statusLabel(artifact.kind || 'artifact'))} • ${escapeHtml(fmtDate(artifact.created_at))}</div>
              <div class="small">${escapeHtml(compactText(artifact.path || 'No artifact path recorded.', 220))}</div>
            </div>
          `).join('') : '<div class="empty compact-empty">No artifacts attached yet.</div>'}
        </div>
      </div>
      <div class="task-card-actions" style="margin-top:14px;">
        <button class="mini-btn" id="selected-session-copy-show-btn">Copy show</button>
        <button class="mini-btn" id="selected-session-copy-resume-btn">Copy resume investigate</button>
        ${findingIdValue ? `<button class="mini-btn" id="selected-session-open-finding-btn">Open finding</button>` : ''}
      </div>
    </div>`;
}

function renderAutomation() {
  const view = state.intelligence.view || 'models';
  const viewCopy = {
    models: ['Model routing', 'Choose any catalog model, persist it as the primary, and configure explicit ordered fallbacks.'],
    review: ['Alert review', 'Queue bounded analysis and control evidence-gated review policy without granting publication rights.'],
    investigations: ['Investigations', 'Track high-priority evidence collection and the coordinated daily workflow.'],
    research: ['Research pipeline', 'Move package, artifact, repository, and extension evidence through safe static analysis, minimized model triage, analyst review, and a review-only draft.'],
    learning: ['Detection learning', 'Evaluate evidence-backed rule changes in replay, shadow, and canary stages before activation.'],
    jobs: ['Analysis jobs', 'Inspect durable requests, provider outcomes, complete results, and recovery actions.']
  }[view] || ['Model routing', 'Choose and persist an approved analysis model.'];
  const summary = el('automation-view-summary');
  if (summary) {
    summary.innerHTML = `<span class="eyebrow">Automation workspace</span><strong>${escapeHtml(viewCopy[0])}</strong><span>${escapeHtml(viewCopy[1])}</span>`;
  }
  const page = el('page-automation');
  if (page) page.dataset.automationView = view;
  document.querySelectorAll('[data-automation-tab]').forEach(button => {
    const active = button.dataset.automationTab === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('#page-automation [data-automation-view]').forEach(section => {
    section.hidden = section.dataset.automationView !== view;
  });
  renderIntelligence();
  if (view === 'research') renderArtifactFleet();
}

function renderIntegrations() {
  const systemView = state.integrationView || 'health';
  const systemViewCopy = {
    health: ['Platform health', 'Check whether Core, Edge, native triage, and the event stream are available.'],
    integrations: ['Integrations', 'Review the runtime connections and data boundaries used by this workspace.'],
    credentials: ['Credentials', 'Review which credentials are required for protected actions and where they are kept.'],
    audit: ['Audit and jobs', 'Trace queued analysis, native actions, investigation sessions, and orchestrator history.']
  }[systemView] || ['Platform health', 'Check whether Core, Edge, native triage, and the event stream are available.'];
  const systemSummary = el('system-view-summary');
  if (systemSummary) systemSummary.innerHTML = `<span class="eyebrow">System workspace</span><strong>${escapeHtml(systemViewCopy[0])}</strong><span>${escapeHtml(systemViewCopy[1])}</span>`;
  const systemPage = el('page-integrations');
  if (systemPage) systemPage.dataset.systemView = systemView;
  document.querySelectorAll('#page-integrations [data-system-section]').forEach(section => {
    const allowed = String(section.dataset.systemSection || '').split(/\s+/).filter(Boolean);
    section.hidden = !allowed.includes(systemView);
  });
  const summary = el('integration-summary');
  const queuedRequests = state.runRequests.filter(r => r.status === 'queued').length;
  const runningRequests = state.runRequests.filter(r => r.status === 'running').length;
  const triageSummary = localTriageSummary();
  const pendingActions = localPendingActions();
  const recentRuns = Array.isArray(state.localTriage?.orchestrator?.recent) ? state.localTriage.orchestrator.recent : [];
  const recentSessions = recentLocalSessions();
  const openSessions = openLocalSessionsCount();
  const pendingApprovals = pendingLocalApprovalsCount();
  const selectedSession = state.selectedSessionDetail;
  const currentAiGuard = state.integrationStatus?.ai_guard || aiGuardConfig();
  if (summary) {
    summary.innerHTML = `
      <div class="card"><div class="metric">${triageSummary ? triageSummary.open_findings ?? 0 : '—'}</div><div class="metric-label">Open findings</div><div class="metric-scope">Local Core triage artifact</div></div>
      <div class="card"><div class="metric">${triageSummary ? triageSummary.in_review_findings ?? 0 : '—'}</div><div class="metric-label">In review</div><div class="metric-scope">Local Core triage artifact</div></div>
      <div class="card"><div class="metric">${triageSummary ? triageSummary.pending_actions ?? pendingActions.length : '—'}</div><div class="metric-label">Pending actions</div><div class="metric-scope">Local Core action queue</div></div>
      <div class="card"><div class="metric">${triageSummary ? triageSummary.applied_actions ?? localAppliedActionsCount() : '—'}</div><div class="metric-label">Applied actions</div><div class="metric-scope">Local Core action queue</div></div>
      <div class="card"><div class="metric">${openSessions}</div><div class="metric-label">Open sessions</div><div class="metric-scope">Local Core session store</div></div>
      <div class="card"><div class="metric">${pendingApprovals}</div><div class="metric-label">Pending approvals</div><div class="metric-scope">Local Core session store</div></div>
      <div class="card"><div class="metric">${localFindingsArtifact()?.total_findings ?? '—'}</div><div class="metric-label">Latest findings artifact total</div><div class="metric-scope">Most recent local artifact</div></div>
      <div class="card"><div class="metric">${recentRuns.length}</div><div class="metric-label">Recent orchestrator runs</div><div class="metric-scope">Local Core retained history</div></div>
      <div class="card"><div class="metric">${escapeHtml(currentAiGuard.hostedEnabled ? 'Guarded enabled' : 'Local-first only')}</div><div class="metric-label">Hosted AI guardrail mode</div><div class="metric-scope">Current workspace policy</div></div>`;
  }

  const cfgEl = el('integration-config');
  if (cfgEl) {
    cfgEl.innerHTML = `
      <div class="card">
        <h3>Native triage helper</h3>
        <div class="kv-list">
          <div class="kv-row"><div class="kv-key">Mode</div><div class="kv-val">${escapeHtml(state.integrationStatus?.helper?.mode || 'local-control-panel')}</div></div>
          <div class="kv-row"><div class="kv-key">Run output API</div><div class="kv-val">${state.integrationStatus?.helper?.run_output_api ? 'Ready' : 'Missing'}</div></div>
          <div class="kv-row"><div class="kv-key">Native triage API</div><div class="kv-val">${state.integrationStatus?.helper?.secopsai_triage_api ? 'Ready' : 'Missing'}</div></div>
          <div class="kv-row"><div class="kv-key">Sessions API</div><div class="kv-val">${state.integrationStatus?.helper?.secopsai_sessions_api ? 'Ready' : 'Missing'}</div></div>
          <div class="kv-row"><div class="kv-key">Research API</div><div class="kv-val">${state.integrationStatus?.helper?.secopsai_research_api ? 'Ready' : 'Missing'}</div></div>
          <div class="kv-row"><div class="kv-key">Campaign API</div><div class="kv-val">${state.integrationStatus?.helper?.secopsai_campaign_api ? 'Ready' : 'Missing'}</div></div>
          <div class="kv-row"><div class="kv-key">Intelligence API</div><div class="kv-val">${state.integrationStatus?.helper?.secopsai_intelligence_api ? 'Ready' : 'Missing'}</div></div>
          <div class="kv-row"><div class="kv-key">Event stream</div><div class="kv-val">${escapeHtml(humanizeSnake(state.nativeStreamStatus || 'disconnected'))}${state.nativeStreamLastEventAt ? ` • ${escapeHtml(fmtDate(state.nativeStreamLastEventAt))}` : ''}</div></div>
          <div class="kv-row"><div class="kv-key">Latest findings artifact</div><div class="kv-val">${escapeHtml(localFindingsArtifact()?.generated_at ? fmtDate(localFindingsArtifact().generated_at) : 'Unavailable')}</div></div>
          <div class="kv-row"><div class="kv-key">Latest orchestrator run</div><div class="kv-val">${escapeHtml(localTriageLatestRun()?.generated_at ? fmtDate(localTriageLatestRun().generated_at) : 'Unavailable')}</div></div>
          <div class="kv-row"><div class="kv-key">Runtime authority</div><div class="kv-val">SecOpsAI / OpenClaw / Hermes</div></div>
        </div>
        <div class="small" style="margin-top:12px;">The dashboard now treats local SecOpsAI triage as a first-class source of truth instead of just a side helper.</div>
      </div>
      <div class="card">
        <h3>Native SecOpsAI</h3>
        <div class="kv-list">
          <div class="kv-row"><div class="kv-key">Repo root</div><div class="kv-val">${escapeHtml(state.localTriage?.secopsai_root || 'Unavailable')}</div></div>
          <div class="kv-row"><div class="kv-key">Latest findings artifact</div><div class="kv-val">${escapeHtml(localFindingsArtifact()?.name || 'Unavailable')}</div></div>
          <div class="kv-row"><div class="kv-key">Latest orchestrator summary</div><div class="kv-val">${escapeHtml(localTriageLatestRun()?.name || 'Unavailable')}</div></div>
          <div class="kv-row"><div class="kv-key">Queue file</div><div class="kv-val">${escapeHtml(state.localTriage?.queue?.path || 'Unavailable')}</div></div>
          <div class="kv-row"><div class="kv-key">Session store</div><div class="kv-val">${escapeHtml(localSessionSummary()?.path || 'Unavailable')}</div></div>
        </div>
        <div class="small" style="margin-top:12px;">Investigation and action history remains local and auditable. Use the approved dashboard workflows for operator changes.</div>
      </div>
      <div class="card">
        <h3>Hosted AI guardrails</h3>
        <div class="kv-list">
          <div class="kv-row"><div class="kv-key">Mode</div><div class="kv-val">${escapeHtml(currentAiGuard.hostedEnabled ? 'Guarded enabled' : 'Local-first only')}</div></div>
          <div class="kv-row"><div class="kv-key">Default model</div><div class="kv-val">${escapeHtml(currentAiGuard.defaultModel || 'Unavailable')}</div></div>
          <div class="kv-row"><div class="kv-key">Run budget</div><div class="kv-val">$${escapeHtml(String(currentAiGuard.maxCostUsd ?? '0'))}</div></div>
          <div class="kv-row"><div class="kv-key">Hosted mutations</div><div class="kv-val">${currentAiGuard.allowMutations ? 'Allowed' : 'Blocked'}</div></div>
        </div>
        <div class="small" style="margin-top:12px;">These guardrails make hosted AI use explicit. Local SecOpsAI triage remains the authority for investigations and writes.</div>
      </div>
      <div class="card">
        <h3>Supabase and run visibility</h3>
        <div class="kv-list">
          <div class="kv-row"><div class="kv-key">Project URL</div><div class="kv-val">${escapeHtml(cfg.supabaseUrl)}</div></div>
          <div class="kv-row"><div class="kv-key">Queued run requests</div><div class="kv-val">${queuedRequests}</div></div>
          <div class="kv-row"><div class="kv-key">Running run requests</div><div class="kv-val">${runningRequests}</div></div>
          <div class="kv-row"><div class="kv-key">Active routes</div><div class="kv-val">${state.channelRoutes.filter(r => r.active).length}</div></div>
        </div>
        <div class="small" style="margin-top:12px;">Supabase remains useful for tasks and run visibility, but native triage queue state now sits above it in the dashboard.</div>
      </div>`;
  }
  const credentialsEl = el('system-credentials');
  if (credentialsEl) {
    const sessionReady = Boolean(state.auth?.user?.email || state.auth?.session || state.auth?.activeUserId);
    const researchTokenReady = Boolean(state.researchCases?.adminToken || state.triageOps?.adminToken);
    const blogTokenReady = Boolean(state.blogOps?.adminToken);
    credentialsEl.innerHTML = `
      <div class="page-header compact-header">
        <div><h3 style="margin:0;">Credential readiness</h3><p class="small" style="margin:6px 0 0;">This view shows status only. Secret values are never displayed or copied.</p></div>
      </div>
      <div class="credential-status-grid">
        <div class="credential-status-row"><span>Operator session</span>${renderStatusPill(sessionReady ? 'ready' : 'missing', sessionReady ? 'Signed in' : 'Sign in required')}</div>
        <div class="credential-status-row"><span>Research action token</span>${renderStatusPill(researchTokenReady ? 'ready' : 'required', researchTokenReady ? 'Ready for protected research actions' : 'Required for changes')}</div>
        <div class="credential-status-row"><span>Blog Ops token</span>${renderStatusPill(blogTokenReady ? 'ready' : 'required', blogTokenReady ? 'Ready for publication actions' : 'Required for publishing')}</div>
        <div class="credential-status-row"><span>Intelligence bridge</span>${renderStatusPill(state.integrationStatus?.helper?.secopsai_intelligence_api ? 'ready' : 'unavailable', state.integrationStatus?.helper?.secopsai_intelligence_api ? 'Server-side bridge available' : 'Unavailable')}</div>
        <div class="credential-status-row"><span>Sensor credentials</span>${renderStatusPill('server-managed', 'Stored by Edge/Core services')}</div>
      </div>
      <p class="small" style="margin:14px 0 0;">Use the Research, Publications, or Automation workspace to enter a session-scoped credential when a protected action requires it. Rotate credentials in the server or local helper, never in this page.</p>`;
  }
  const sessionsTable = el('native-sessions-table');
  if (sessionsTable) {
    if (!recentSessions.length) {
      sessionsTable.innerHTML = `<div class="empty">No investigation sessions found yet. Use “Investigate now” on a finding and the dashboard will create and track a native SecOpsAI session automatically.</div>`;
    } else {
      sessionsTable.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>Status</th><th>Session</th><th>Finding</th><th>Progress</th><th>Approvals</th><th>Updated</th><th>Actions</th></tr></thead>
          <tbody>${recentSessions.map(session => `
            <tr>
              <td>${renderStatusPill(String(session.status || 'open').toLowerCase(), humanizeSnake(session.status || 'open'))}</td>
              <td><strong>${escapeHtml(session.title || session.session_id || 'session')}</strong><div class="small">${escapeHtml(session.session_id || '—')}</div></td>
              <td><div class="small">${escapeHtml(session.subject?.finding_id || '—')}</div><div class="small muted-inline">${escapeHtml(compactText(session.subject?.title || '', 90))}</div></td>
              <td><div class="small">${escapeHtml(sessionProgressLabel(session))}</div><div class="small muted-inline">${escapeHtml(compactText(session.latest_event?.message || 'No recent event.', 120))}</div></td>
              <td><div class="small">${escapeHtml(String(session.pending_approvals || 0))} pending</div><div class="small muted-inline">${escapeHtml(String(session.artifact_count || 0))} artifacts</div></td>
              <td>${escapeHtml(fmtDate(session.updated_at))}</td>
              <td><div class="task-card-actions"><button class="mini-btn integration-session-select-btn" data-session-id="${escapeHtml(session.session_id || '')}">Inspect</button>${pendingApprovalsForSession(session)[0] ? `<button class="mini-btn integration-session-approve-btn" data-session-id="${escapeHtml(session.session_id || '')}" data-approval-id="${escapeHtml(pendingApprovalsForSession(session)[0].approval_id || '')}">Approve top</button>` : ''}<button class="mini-btn integration-session-copy-btn" data-command="${escapeHtml(sessionShowCommand(session))}">Copy show</button></div></td>
            </tr>
          `).join("")}</tbody>
        </table></div>`;
      sessionsTable.querySelectorAll('.integration-session-select-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          await selectNativeSession(btn.dataset.sessionId, { focusFinding: false });
        });
      });
      sessionsTable.querySelectorAll('.integration-session-copy-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          await copyTextWithStatus(btn.dataset.command || '', 'Session command copied');
        });
      });
      sessionsTable.querySelectorAll('.integration-session-approve-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await runNativeResolveApproval(btn.dataset.sessionId, btn.dataset.approvalId, { decision: 'approved', apply: true });
          } catch (err) {
            console.error('session approval failed', err);
            setStatus(err.message || String(err), true);
          }
        });
      });
    }
  }

  const sessionDetailHost = el('native-session-detail');
  if (sessionDetailHost) {
    sessionDetailHost.innerHTML = renderSessionDetail(selectedSession);
    sessionDetailHost.querySelector('#selected-session-copy-show-btn')?.addEventListener('click', () => {
      copyTextWithStatus(sessionShowCommand(selectedSession), 'Session show command copied');
    });
    sessionDetailHost.querySelector('#selected-session-copy-resume-btn')?.addEventListener('click', () => {
      copyTextWithStatus(sessionResumeCommand(selectedSession, { withResearch: true }), 'Resume investigate command copied');
    });
    sessionDetailHost.querySelector('#selected-session-open-finding-btn')?.addEventListener('click', async () => {
      const findingIdValue = String(selectedSession?.subject?.finding_id || '').trim();
      if (!findingIdValue) return;
      selectFinding(findingIdValue);
      renderFindings();
      await selectNativeSession(selectedSession?.session_id, { focusFinding: false });
    });
    sessionDetailHost.querySelectorAll('.selected-session-approve-btn').forEach(btn => btn.addEventListener('click', async () => {
      try {
        await runNativeResolveApproval(btn.dataset.sessionId, btn.dataset.approvalId, { decision: 'approved', apply: true });
      } catch (err) {
        console.error('selected session approval failed', err);
        setStatus(err.message || String(err), true);
      }
    }));
    sessionDetailHost.querySelectorAll('.selected-session-reject-btn').forEach(btn => btn.addEventListener('click', async () => {
      try {
        await runNativeResolveApproval(btn.dataset.sessionId, btn.dataset.approvalId, { decision: 'rejected', apply: false });
      } catch (err) {
        console.error('selected session rejection failed', err);
        setStatus(err.message || String(err), true);
      }
    }));
  }

  const table = el('routes-table');
  if (!table) return;
  if (!recentRuns.length) {
    table.innerHTML = `<div class="empty">No orchestrator summaries found yet. Run the SecOpsAI orchestrator locally and refresh this page to populate recent history.</div>`;
    return;
  }
  table.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Generated</th><th>Processed</th><th>Open findings</th><th>Queued</th><th>Applied</th><th>Summary</th></tr></thead>
      <tbody>${recentRuns.map(run => `
        <tr>
          <td>${escapeHtml(fmtDate(run.generated_at))}</td>
          <td>${escapeHtml(String(run.processed ?? '—'))}</td>
          <td>${escapeHtml(String(run.open_findings ?? '—'))}</td>
          <td>${escapeHtml(String(run.queued ?? '—'))}</td>
          <td>${escapeHtml(String(run.auto_applied ?? run.applied_actions ?? '—'))}</td>
          <td><div class="small">${escapeHtml(compactText(run.findings?.[0]?.summary || 'Native orchestrator run recorded locally.', 160))}</div></td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}

function intelligenceJobs() {
  return Array.isArray(state.intelligence.data?.jobs?.jobs) ? state.intelligence.data.jobs.jobs : [];
}

function intelligenceBridgeActions() {
  return Array.isArray(state.intelligence.data?.actions?.actions) ? state.intelligence.data.actions.actions.filter(item => item?.requires_bridge) : [];
}

function intelligenceModels() {
  return Array.isArray(state.intelligence.data?.models?.models) ? state.intelligence.data.models.models : [];
}

function isDurableIntelligenceTarget(target) {
  return /^(?:RSC|RSCF)-/.test(String(target || '').trim());
}

function latestIntelligenceJobs(jobs) {
  const latestCasePipelines = new Map();
  (Array.isArray(jobs) ? jobs : []).forEach(job => {
    const target = String(job?.target_id || '').trim();
    const pipeline = String(job?.pipeline_id || job?.input?.pipeline_id || job?.config?.pipeline_id || '').trim();
    if (!isDurableIntelligenceTarget(target) || !pipeline) return;
    const current = latestCasePipelines.get(target);
    const timestamp = String(job.updated_at || job.queued_at || '');
    if (!current || timestamp > current.timestamp) latestCasePipelines.set(target, { pipeline, timestamp });
  });
  const latest = new Map();
  (Array.isArray(jobs) ? jobs : []).forEach(job => {
    const target = String(job?.target_id || '').trim();
    const pipeline = String(job?.pipeline_id || job?.input?.pipeline_id || job?.config?.pipeline_id || '').trim();
    // Keep every stage from the newest case pipeline. Older retries remain in
    // the API/audit trail but must not be mixed into the current stage row.
    if (isDurableIntelligenceTarget(target) && pipeline && latestCasePipelines.get(target)?.pipeline !== pipeline) return;
    const action = String(job?.action || 'analysis').trim();
    const key = pipeline
      ? `pipeline:${pipeline}:${action}`
      : (isDurableIntelligenceTarget(target) ? `target:${target}:${action}` : `job:${job?.job_id || target}`);
    const current = latest.get(key);
    if (!current) {
      latest.set(key, { ...job, history_count: 1 });
      return;
    }
    current.history_count = Number(current.history_count || 1) + 1;
    const currentTime = String(current.updated_at || current.queued_at || '');
    const nextTime = String(job.updated_at || job.queued_at || '');
    if (nextTime > currentTime) latest.set(key, { ...job, history_count: current.history_count });
  });
  return [...latest.values()].sort((left, right) => String(right.updated_at || right.queued_at || '').localeCompare(String(left.updated_at || left.queued_at || '')));
}

function intelligencePipelineGroups(jobs) {
  const groups = new Map();
  jobs.forEach(job => {
    const target = String(job?.target_id || 'Workspace');
    const explicitPipeline = String(job?.pipeline_id || job?.input?.pipeline_id || job?.config?.pipeline_id || '').trim();
    // Research cases are durable pipeline targets. Workspace actions remain
    // individual rows so unrelated runs are never merged together.
    const key = explicitPipeline || (isDurableIntelligenceTarget(target) ? `target:${target}` : `job:${job?.job_id || target}`);
    if (!groups.has(key)) groups.set(key, { key, target, pipelineId: explicitPipeline, jobs: [] });
    groups.get(key).jobs.push(job);
  });
  return [...groups.values()].map(group => {
    group.jobs.sort((left, right) => String(left.updated_at || left.queued_at || '').localeCompare(String(right.updated_at || right.queued_at || '')));
    const completed = group.jobs.filter(item => ['succeeded', 'completed'].includes(String(item.status || '').toLowerCase())).length;
    const newest = group.jobs[group.jobs.length - 1] || {};
    const newestStatus = String(newest.status || '').toLowerCase();
    // A historical failed attempt must not mask a newer queued/running job.
    // The newest actionable row is the current state; failures remain visible
    // through the per-job audit view.
    group.status = ['succeeded', 'completed'].includes(newestStatus)
      ? 'completed'
      : (newest.status || (completed === group.jobs.length ? 'completed' : 'pending'));
    group.current = newest || {};
    group.completed = completed;
    group.total = group.jobs.length;
    return group;
  });
}

function intelligencePipelineLabel(group) {
  const target = String(group?.target || '');
  if (target.startsWith('RSCF-')) return 'Finding pipeline';
  if (target.startsWith('RSC-')) return 'Research case pipeline';
  if (target.startsWith('SOR-')) return 'Specialist pipeline';
  return group?.pipelineId ? 'Analysis pipeline' : 'Analysis job';
}

function intelligenceStageLabel(action) {
  const labels = {
    analyze_research_case: 'Analyze case',
    generate_analyst_brief: 'Analyst brief',
    review_publication_safety: 'Publication safety',
    triage_finding: 'Finding triage',
    explain_finding: 'Explain finding',
    recommend_remediation: 'Remediation',
  };
  return labels[String(action || '').toLowerCase()] || humanizeSnake(action || 'Analysis');
}

function intelligenceSelectedModel() {
  const models = intelligenceModels();
  const ids = models.map(item => String(item?.id || ''));
  const pending = String(state.intelligence.pendingSelectedModel || '');
  if (pending && (ids.includes(pending) || !models.length)) return pending;
  const persisted = String(state.intelligence.data?.bridge?.selected_model || '');
  if (persisted && (ids.includes(persisted) || !models.length)) return persisted;
  const stored = String(state.intelligence.selectedModel || '');
  if (stored && ids.includes(stored)) return stored;
  const defaultModel = String(state.intelligence.data?.models?.default_model || '');
  if (defaultModel && (ids.includes(defaultModel) || !models.length)) return defaultModel;
  return ids[0] || '';
}

function intelligenceResultList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map(item => {
    if (typeof item === 'string') return item.trim();
    if (item && typeof item === 'object') {
      const statement = String(item.statement || item.title || item.text || '').trim();
      const refs = Array.isArray(item.evidence_refs || item.evidence) ? (item.evidence_refs || item.evidence) : [];
      return statement && refs.length ? `${statement} (evidence: ${refs.join(', ')})` : (statement || JSON.stringify(item));
    }
    return String(item || '').trim();
  }).filter(item => {
    if (!item || seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

function intelligenceResultView(job) {
  const envelope = job?.result && typeof job.result === 'object' ? job.result : {};
  const data = envelope?.data && typeof envelope.data === 'object' ? envelope.data : envelope;
  const action = String(job?.action || '').trim().toLowerCase();
  const finalVerdictAction = ['analyze_research_case', 'review_finding', 'investigation_verdict'].includes(action);
  const brief = data?.analyst_brief && typeof data.analyst_brief === 'object' ? data.analyst_brief : {};
  const triage = data?.triage_analysis && typeof data.triage_analysis === 'object' ? data.triage_analysis : {};
  const handling = data?.handling_proposal && typeof data.handling_proposal === 'object' ? data.handling_proposal : {};
  const mergeLists = (...values) => intelligenceResultList(values.flatMap(value => Array.isArray(value) ? value : []));
  return {
    summary: String(data.summary || data.automation_note || data.executive_summary || brief.executive_summary || job?.error_message || '').trim(),
    riskAssessment: String(data.risk_assessment || data.risk || brief.risk_assessment || (finalVerdictAction && data.finding_verdict ? `Model verdict: ${humanizeSnake(data.finding_verdict)} at ${Number(data.finding_confidence || 0)}% confidence.` : '')).trim(),
    confirmedFacts: mergeLists(data.confirmed_facts, brief.facts, triage.facts),
    inferences: mergeLists(data.inferences, brief.inferences, triage.inferences),
    unsupportedClaims: intelligenceResultList(data.unsupported_claims),
    contradictions: intelligenceResultList(data.contradictions),
    missingEvidence: intelligenceResultList(data.missing_evidence),
    evidence: intelligenceResultList(data.evidence),
    recommendedActions: mergeLists(data.recommended_actions, data.recommendations, data.next_steps, brief.recommended_actions, brief.next_steps, handling.immediate_reversible_steps, handling.containment_if_corroborated, handling.escalation_path ? [handling.escalation_path] : []),
    limitations: mergeLists(data.limitations, brief.limitations, triage.limitations, envelope.limitations),
    publicationRisks: intelligenceResultList(data.publication_risks),
    articleOutline: intelligenceResultList(data.article_outline),
    disclosureDraft: String(data.disclosure_draft || '').trim(),
    // Only verdict-producing actions may populate the verdict banner. Briefs
    // and publication-safety reviews can contain generic finding fields for
    // context, but they must never be presented as a final 0% decision.
    verdict: String(finalVerdictAction ? (data.verdict_recommendation || data.finding_verdict || '') : (data.final_verdict || '')).trim(),
    verdictConfidence: Number(finalVerdictAction ? (data.verdict_confidence ?? data.finding_confidence ?? 0) : (data.final_verdict_confidence ?? 0)),
    verdictScope: finalVerdictAction ? 'final' : 'advisory',
    verdictScopeMessage: finalVerdictAction ? '' : 'This action produced advisory analysis. It did not assess a final case verdict.',
    verdictRationale: String(data.verdict_rationale || data.summary || '').trim(),
    verdictEvidenceRefs: intelligenceResultList(data.decision_evidence_refs || data.verdict_evidence_refs),
    dispositionRecommendation: String(data.disposition_recommendation || '').trim(),
    exposureAssessment: String(data.exposure_assessment || '').trim(),
    automationRecommendation: String(data.automation_recommendation || '').trim(),
    counterarguments: intelligenceResultList(data.counterarguments),
    tuningProposals: Array.isArray(data.rule_tuning_proposals) ? data.rule_tuning_proposals : [],
    assessment: String(data.assessment || data.assessment_label || data.maliciousness_verdict || (finalVerdictAction ? data.verdict_recommendation || data.finding_verdict : '') || 'unconfirmed_static_lead').trim(),
    assessmentConfidence: Number(data.detection_confidence ?? data.assessment_confidence ?? data.verdict_confidence ?? data.finding_confidence ?? 0),
    investigationPriority: String(data.investigation_priority || data.priority || 'normal').trim(),
    potentialImpact: String(data.potential_impact || data.impact_severity || job?.severity || 'medium').trim(),
    localExposure: String(data.local_exposure || data.exposure_assessment || 'unknown').trim(),
    evidenceQuality: String(data.evidence_quality || data.evidence_quality_label || 'insufficient').trim(),
    publicationReadiness: String(data.publication_readiness || data.publication_status || 'blocked').trim(),
    uniqueObservations: Number(data.unique_observations ?? data.observation_summary?.unique_observations ?? 0),
    repeatObservations: Number(data.repeat_observations ?? data.observation_summary?.repeat_observations ?? 0),
    independentSources: Number(data.independent_sources ?? data.observation_summary?.independent_sources ?? 0),
    provider: String(envelope.provider || job?.provider || '').trim(),
    generatedAt: String(envelope.generated_at || job?.completed_at || job?.updated_at || '').trim(),
    readOnly: envelope.read_only !== false,
    events: Array.isArray(job?.events) ? job.events : [],
    normalized: envelope
  };
}

function renderIntelligenceResultList(items, emptyText) {
  if (!items.length) return `<p class="small intelligence-result-empty">${escapeHtml(emptyText)}</p>`;
  return `<ol class="intelligence-result-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`;
}

function renderIntelligenceResultSection(title, content, { tone = '', wide = false } = {}) {
  return `<section class="intelligence-result-section ${wide ? 'wide' : ''} ${tone ? `tone-${escapeHtml(tone)}` : ''}"><h4>${escapeHtml(title)}</h4>${content}</section>`;
}

function intelligenceResultMarkdown(job) {
  const view = intelligenceResultView(job);
  const lines = [
    `# ${humanizeSnake(job?.action || 'analysis')} — ${job?.job_id || ''}`,
    '',
    `- Target: ${job?.target_id || 'Workspace'}`,
    `- Status: ${humanizeSnake(job?.status || 'unknown')}`,
    `- Provider: ${view.provider || 'Not recorded'}`,
    `- Generated: ${view.generatedAt || 'Not recorded'}`,
  ];
  const textSection = (title, value) => { if (value) lines.push('', `## ${title}`, '', value); };
  const listSection = (title, values) => { if (values.length) lines.push('', `## ${title}`, '', ...values.map(item => `- ${item}`)); };
  textSection('Executive Summary', view.summary);
  if (view.verdict) {
    lines.push('', '## Verdict', '', `${humanizeSnake(view.verdict)} — ${view.verdictConfidence}% confidence`);
    textSection('Verdict Rationale', view.verdictRationale);
    listSection('Verdict Evidence References', view.verdictEvidenceRefs);
    textSection('Disposition Recommendation', humanizeSnake(view.dispositionRecommendation));
    textSection('Exposure Assessment', humanizeSnake(view.exposureAssessment));
    textSection('Automation Recommendation', humanizeSnake(view.automationRecommendation));
  }
  textSection('Risk Assessment', view.riskAssessment);
  listSection('Confirmed Facts', view.confirmedFacts);
  listSection('Inferences', view.inferences);
  listSection('Contradictions', view.contradictions);
  listSection('Counterarguments', view.counterarguments);
  listSection('Detection Tuning Proposals', view.tuningProposals.map(item => typeof item === 'string' ? item : `${item.target_id || item.rule || item.target_type || 'Proposal'}: ${item.rationale || item.proposal || item.expected_effect || JSON.stringify(item)}`));
  listSection('Unsupported Claims', view.unsupportedClaims);
  listSection('Missing Evidence', view.missingEvidence);
  listSection('Recommended Next Steps', view.recommendedActions);
  listSection('Evidence Cited', view.evidence);
  listSection('Limitations', view.limitations);
  listSection('Publication Risks', view.publicationRisks);
  listSection('Article Outline', view.articleOutline);
  textSection('Disclosure Draft', view.disclosureDraft);
  if (view.events.length) lines.push('', '## Job Audit History', '', ...view.events.map(event => `- ${event.created_at || ''} — ${humanizeSnake(event.event_type || '')}: ${event.message || ''}`));
  return lines.join('\n').trim();
}

function renderIntelligenceResultModal() {
  const job = intelligenceJobs().find(item => item.job_id === state.intelligence.selectedJobId);
  const body = el('intelligence-result-body');
  if (!job || !body) return;
  const view = intelligenceResultView(job);
  if (el('intelligence-result-title')) el('intelligence-result-title').textContent = humanizeSnake(job.action || 'Analysis result');
  if (el('intelligence-result-subtitle')) el('intelligence-result-subtitle').textContent = `${job.job_id} · ${job.target_id || 'Workspace'} · ${view.provider || 'Provider not recorded'}`;
  if (el('intelligence-result-open-case')) el('intelligence-result-open-case').hidden = !String(job.target_id || '').startsWith('RSC-');
  const verdict = view.verdict
    ? `<div class="intelligence-verdict"><span>Agent verdict</span><strong>${escapeHtml(humanizeSnake(view.verdict))}</strong><b>${escapeHtml(String(view.verdictConfidence))}% confidence</b></div>`
    : (view.verdictScopeMessage ? `<div class="intelligence-advisory-note">${escapeHtml(view.verdictScopeMessage)}</div>` : '');
  const meta = `<div class="intelligence-result-meta"><span>${escapeHtml(humanizeSnake(job.status || 'unknown'))}</span><span>${escapeHtml(fmtDate(view.generatedAt))}</span><span>${view.readOnly ? 'Read-only analysis' : 'Recorded result'}</span></div>`;
  const decisionAssessment = view.verdict || view.assessment || 'unconfirmed_static_lead';
  const decisionFacts = view.confirmedFacts.slice(0, 3);
  const decisionContradictions = view.contradictions.slice(0, 2);
  const decisionCard = `<section class="intelligence-decision-card" aria-label="Decision card">
    <div class="intelligence-decision-card-head"><div><span class="eyebrow">Assessment</span><strong>${escapeHtml(humanizeSnake(decisionAssessment))}</strong><p>${escapeHtml(view.summary || 'Evidence is available for analyst review; no automatic maliciousness verdict was established.')}</p></div><span class="decision-card-badge">${escapeHtml(humanizeSnake(view.publicationReadiness))}</span></div>
    <div class="intelligence-decision-metrics"><div><span>Detection confidence</span><b>${escapeHtml(String(view.assessmentConfidence))}%</b></div><div><span>Investigation priority</span><b>${escapeHtml(humanizeSnake(view.investigationPriority))}</b></div><div><span>Potential impact</span><b>${escapeHtml(humanizeSnake(view.potentialImpact))}</b></div><div><span>Local exposure</span><b>${escapeHtml(humanizeSnake(view.localExposure))}</b></div><div><span>Evidence quality</span><b>${escapeHtml(humanizeSnake(view.evidenceQuality))}</b></div><div><span>Observations</span><b>${escapeHtml(String(view.uniqueObservations))} unique · ${escapeHtml(String(view.repeatObservations))} repeated</b></div></div>
    <div class="intelligence-decision-columns"><div><h4>Confirmed facts</h4>${renderIntelligenceResultList(decisionFacts, 'No confirmed facts returned.')}</div><div><h4>Contradictions</h4>${renderIntelligenceResultList(decisionContradictions, 'None identified.')}</div><div><h4>Next action</h4><p>${escapeHtml(view.recommendedActions[0] || 'Review the evidence and record a human decision.')}</p></div></div>
  </section>`;
  const sections = [
    renderIntelligenceResultSection('Executive summary', view.summary ? `<p>${escapeHtml(view.summary)}</p>` : '<p class="small">No executive summary was returned.</p>', { wide: true }),
    renderIntelligenceResultSection('Verdict rationale', view.verdictRationale ? `<p>${escapeHtml(view.verdictRationale)}</p>${renderIntelligenceResultList(view.verdictEvidenceRefs, 'No verdict evidence references returned.')}` : '<p class="small">This action did not assess a verdict.</p>', { tone: view.verdict ? 'decision' : '' }),
    view.dispositionRecommendation ? renderIntelligenceResultSection('Decision recommendation', `<div class="kv-list"><div class="kv-row"><div class="kv-key">Disposition</div><div class="kv-val">${escapeHtml(humanizeSnake(view.dispositionRecommendation))}</div></div><div class="kv-row"><div class="kv-key">Exposure</div><div class="kv-val">${escapeHtml(humanizeSnake(view.exposureAssessment || 'unknown'))}</div></div><div class="kv-row"><div class="kv-key">Automation</div><div class="kv-val">${escapeHtml(humanizeSnake(view.automationRecommendation || 'collect_evidence'))}</div></div></div>`, { tone: 'decision' }) : '',
    renderIntelligenceResultSection('Risk assessment', view.riskAssessment ? `<p>${escapeHtml(view.riskAssessment)}</p>` : '<p class="small">No consolidated risk assessment returned.</p>'),
    renderIntelligenceResultSection('Confirmed facts', renderIntelligenceResultList(view.confirmedFacts, 'No confirmed facts returned.'), { tone: 'fact' }),
    renderIntelligenceResultSection('Reasonable inferences', renderIntelligenceResultList(view.inferences, 'No inferences returned.')),
    renderIntelligenceResultSection('Contradictions', renderIntelligenceResultList(view.contradictions, 'No contradictions identified.'), { tone: 'warning' }),
    renderIntelligenceResultSection('Counterarguments', renderIntelligenceResultList(view.counterarguments, 'No counterarguments returned.'), { tone: 'warning' }),
    renderIntelligenceResultSection('Detection tuning proposals', renderIntelligenceResultList(view.tuningProposals.map(item => typeof item === 'string' ? item : `${item.target_id || item.rule || item.target_type || 'Proposal'}: ${item.rationale || item.proposal || item.expected_effect || JSON.stringify(item)}`), 'No tuning proposals returned.'), { tone: 'action', wide: true }),
    renderIntelligenceResultSection('Unsupported claims', renderIntelligenceResultList(view.unsupportedClaims, 'No unsupported claims identified.'), { tone: 'warning' }),
    renderIntelligenceResultSection('Missing evidence', renderIntelligenceResultList(view.missingEvidence, 'No missing evidence reported.'), { tone: 'gap' }),
    renderIntelligenceResultSection('Recommended next steps', renderIntelligenceResultList(view.recommendedActions, 'No recommended actions returned.'), { tone: 'action', wide: true }),
    renderIntelligenceResultSection('Evidence cited', renderIntelligenceResultList(view.evidence, 'No separate evidence list returned.'), { wide: true }),
    renderIntelligenceResultSection('Limitations', renderIntelligenceResultList(view.limitations, 'No limitations returned.')),
    renderIntelligenceResultSection('Publication risks', renderIntelligenceResultList(view.publicationRisks, 'No publication risks returned.'), { tone: 'warning' }),
    renderIntelligenceResultSection('Technical article outline', renderIntelligenceResultList(view.articleOutline, 'No article outline returned.'), { wide: true }),
    view.disclosureDraft ? renderIntelligenceResultSection('Disclosure draft', `<pre class="intelligence-result-draft">${escapeHtml(view.disclosureDraft)}</pre>`, { wide: true }) : '',
    renderIntelligenceResultSection('Job audit history', renderIntelligenceResultList(view.events.map(event => `${fmtDate(event.created_at)} — ${humanizeSnake(event.event_type || '')}: ${event.message || ''}`), 'No job events returned.'), { wide: true }),
    renderIntelligenceResultSection('Normalized result', `<details><summary>View normalized JSON</summary><pre class="intelligence-result-json">${escapeHtml(JSON.stringify(view.normalized, null, 2))}</pre></details>`, { wide: true })
  ].filter(Boolean).join('');
  body.innerHTML = `${meta}${verdict}${decisionCard}<details class="intelligence-full-analysis"><summary>Open full analysis</summary><div class="intelligence-result-grid">${sections}</div></details>`;
}

async function loadIntelligenceJobDetail(jobId) {
  const response = await dashboardApiFetch(`/api/secopsai/intelligence/jobs/${encodeURIComponent(jobId)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok || !payload.job) {
    throw new Error(payload.error || `Unable to load analysis job (${response.status})`);
  }
  const jobs = state.intelligence.data?.jobs?.jobs;
  if (Array.isArray(jobs)) {
    const index = jobs.findIndex(item => String(item.job_id || '') === String(jobId));
    if (index >= 0) jobs[index] = payload.job;
    else jobs.unshift(payload.job);
  }
  return payload.job;
}

async function openIntelligenceResult(jobId) {
  state.intelligence.selectedJobId = jobId;
  const initialJob = intelligenceJobs().find(item => item.job_id === jobId);
  const body = el('intelligence-result-body');
  if (body) body.innerHTML = '<p class="small">Loading the complete, normalized analysis…</p>';
  const modal = el('intelligence-result-modal');
  modal?.classList.remove('hidden');
  modal?.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  el('intelligence-result-close')?.focus();
  if (initialJob?.result_available && !Object.keys(initialJob.result || {}).length) {
    try {
      await loadIntelligenceJobDetail(jobId);
    } catch (error) {
      if (body) body.innerHTML = `<p class="error">${escapeHtml(error?.message || String(error))}</p>`;
      return;
    }
  }
  renderIntelligenceResultModal();
}

function closeIntelligenceResult() {
  const modal = el('intelligence-result-modal');
  modal?.classList.add('hidden');
  modal?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  const selectedJobId = state.intelligence.selectedJobId;
  if (selectedJobId) document.querySelector(`[data-intelligence-review="${CSS.escape(selectedJobId)}"]`)?.focus();
}

async function openIntelligenceResearchCase() {
  const job = intelligenceJobs().find(item => item.job_id === state.intelligence.selectedJobId);
  const caseId = String(job?.target_id || '');
  if (!caseId.startsWith('RSC-')) return;
  closeIntelligenceResult();
  await openResearchCase(caseId);
}

function renderIntelligenceModelSelect() {
  const select = el('intelligence-model-select');
  if (!select) return;
  const models = intelligenceModels();
  const selected = intelligenceSelectedModel();
  const fallback = Array.isArray(state.intelligence.data?.bridge?.fallback_models) ? state.intelligence.data.bridge.fallback_models : [];
  if (!state.intelligence.routingDirty) {
    state.intelligence.fallbackModels = fallback.filter(model => model !== selected);
    state.intelligence.fallbackMode = String(state.intelligence.data?.bridge?.fallback_mode || (fallback.length ? 'quota_auth' : 'disabled'));
  }
  const effectiveChain = Array.isArray(state.intelligence.data?.bridge?.effective_model_chain)
    ? state.intelligence.data.bridge.effective_model_chain
    : [selected, ...fallback].filter(Boolean);
  if (!models.length) {
    const errorText = state.intelligence.data?.models_error ? `Catalog unavailable — provider default will be used` : 'Catalog loading…';
    select.innerHTML = `<option value="">${escapeHtml(errorText)}</option>`;
    select.disabled = true;
  } else {
    const groups = {};
    models.forEach(item => {
      const provider = String(item?.provider || 'other');
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(item);
    });
    const optionHtml = Object.keys(groups).sort().map(provider => {
      const options = groups[provider].map(item => {
        const id = String(item?.id || '');
        const mark = fallback.includes(id) ? ' — fallback' : '';
        return `<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(id)}${escapeHtml(mark)}</option>`;
      }).join('');
      return `<optgroup label="${escapeHtml(provider)}">${options}</optgroup>`;
    }).join('');
    select.innerHTML = optionHtml;
    select.disabled = false;
  }
  const hint = el('intelligence-model-hint');
  if (hint) {
    const fallbackText = effectiveChain.length ? ` Effective chain: ${effectiveChain.join(' → ')}.` : '';
    hint.textContent = selected
      ? `Runs the next queued job on ${selected}.${fallbackText || ' No fallback models are enabled.'}`
      : 'Pick a model. The next job and health probe will use only that selection.';
  }
  state.intelligence.selectedModel = selected;
  if (selected) sessionStorage.setItem('secopsai_bridge_model', selected);
  renderIntelligenceRouting();
}

function renderIntelligenceRouting() {
  const primary = intelligenceSelectedModel();
  const models = intelligenceModels();
  const query = String(state.intelligence.modelSearch || '').trim().toLowerCase();
  const search = el('intelligence-model-search');
  if (search && document.activeElement !== search && search.value !== state.intelligence.modelSearch) {
    search.value = state.intelligence.modelSearch;
  }
  const configured = state.intelligence.fallbackModels.filter(model => model && model !== primary);
  const mode = el('intelligence-fallback-mode');
  if (mode && document.activeElement !== mode) mode.value = state.intelligence.fallbackMode || 'disabled';
  const source = el('intelligence-routing-source');
  if (source) source.textContent = state.intelligence.routingDirty
    ? 'Unsaved changes'
    : `${humanizeSnake(state.intelligence.data?.bridge?.routing_source || 'runtime')} policy`;
  const catalog = el('intelligence-model-catalog');
  if (catalog) {
    const visible = models.filter(item => {
      const id = String(item?.id || '');
      return id && id !== primary && (!query || `${id} ${item?.provider || ''}`.toLowerCase().includes(query));
    });
    catalog.innerHTML = visible.length ? visible.map(item => {
      const id = String(item.id || '');
      const selected = configured.includes(id);
      return `<label class="model-catalog-row ${selected ? 'selected' : ''}"><input type="checkbox" data-routing-fallback="${escapeHtml(id)}" ${selected ? 'checked' : ''}/><span><strong>${escapeHtml(id)}</strong><small>${escapeHtml(humanizeSnake(item.provider || 'provider'))}</small></span></label>`;
    }).join('') : '<div class="empty-state compact">No models match this search.</div>';
  }
  const order = el('intelligence-fallback-order');
  if (order) order.innerHTML = configured.length
    ? `<div class="model-routing-order-title">Fallback order</div>${configured.map((model, index) => `<div class="model-routing-item"><span>${index + 1}</span><strong>${escapeHtml(model)}</strong><div><button class="mini-btn" data-routing-move="up" data-routing-model="${escapeHtml(model)}" ${index === 0 ? 'disabled' : ''} type="button">Up</button><button class="mini-btn" data-routing-move="down" data-routing-model="${escapeHtml(model)}" ${index === configured.length - 1 ? 'disabled' : ''} type="button">Down</button><button class="mini-btn" data-routing-remove="${escapeHtml(model)}" type="button">Remove</button></div></div>`).join('')}`
    : '<div class="empty-state compact">No fallback models configured. Jobs remain queued if the primary model is unavailable.</div>';
}

function setRoutingFallback(model, enabled) {
  const primary = intelligenceSelectedModel();
  const next = state.intelligence.fallbackModels.filter(item => item !== model && item !== primary);
  if (enabled && model && model !== primary) next.push(model);
  state.intelligence.fallbackModels = next.slice(0, 8);
  state.intelligence.routingDirty = true;
  renderIntelligenceRouting();
}

async function saveIntelligenceRouting(button = null) {
  const primary = intelligenceSelectedModel();
  if (!primary) {
    showToast('Select a primary model first.', 'error');
    return null;
  }
  const mode = state.intelligence.fallbackModels.length
    ? (state.intelligence.fallbackMode || 'quota_auth')
    : 'disabled';
  const result = await runIntelligenceAction('configure-models', {
    primary_model: primary,
    fallback_models: mode === 'disabled' ? [] : state.intelligence.fallbackModels,
    fallback_mode: mode
  }, button);
  if (result) {
    state.intelligence.pendingSelectedModel = '';
    state.intelligence.routingDirty = false;
    await loadIntelligence();
  }
  return result;
}

function renderAutopilotModelSelect(settings = {}) {
  const select = el('intelligence-autopilot-model');
  if (!select) return;
  const models = intelligenceModels();
  const configured = String(settings.selected_model || '').trim();
  if (!models.length) {
    select.innerHTML = `<option value="${escapeHtml(configured)}">${escapeHtml(configured || 'Model catalog unavailable')}</option>`;
    select.disabled = true;
    return;
  }
  const ids = models.map(item => String(item?.id || '')).filter(Boolean);
  const selected = ids.includes(configured) ? configured : (configured || intelligenceSelectedModel());
  const groups = {};
  models.forEach(item => {
    const provider = String(item?.provider || 'other');
    if (!groups[provider]) groups[provider] = [];
    groups[provider].push(item);
  });
  const missing = configured && !ids.includes(configured)
    ? `<option value="${escapeHtml(configured)}" selected>${escapeHtml(configured)} — configured, unavailable</option>`
    : '';
  select.innerHTML = missing + Object.keys(groups).sort().map(provider => {
    const options = groups[provider].map(item => {
      const id = String(item?.id || '');
      return `<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(id)}</option>`;
    }).join('');
    return `<optgroup label="${escapeHtml(provider)}">${options}</optgroup>`;
  }).join('');
  select.disabled = false;
}

function intelligenceActionNeedsTarget(action) {
  return !['prioritize_findings'].includes(String(action || ''));
}

function suggestedIntelligenceTarget(action) {
  const normalized = String(action || '');
  if (['triage_finding', 'explain_finding', 'recommend_remediation'].includes(normalized)) return String(state.selectedFindingId || '');
  if (['analyze_research_case', 'generate_analyst_brief', 'review_publication_safety'].includes(normalized)) return String(state.researchCases.selectedId || '');
  return '';
}

function syncIntelligenceTarget() {
  const action = el('intelligence-action-select')?.value || 'prioritize_findings';
  const target = el('intelligence-target-id');
  if (!target) return;
  const suggested = suggestedIntelligenceTarget(action);
  const requiresTarget = intelligenceActionNeedsTarget(action);
  if (!requiresTarget) {
    // Workspace-wide actions must never inherit a stale finding, case, or arbitrary text.
    target.value = '';
    target.dataset.suggested = '0';
  } else if (!target.value.trim() || target.dataset.suggested === '1') {
    target.value = suggested;
    target.dataset.suggested = suggested ? '1' : '0';
  }
  target.required = requiresTarget;
  target.placeholder = target.required ? 'Required: select or enter a valid SecOpsAI ID' : 'Not required for workspace prioritization';
  const hint = el('intelligence-request-hint');
  if (hint) hint.textContent = target.required
    ? (suggested ? `Using the currently selected SecOpsAI record: ${suggested}` : 'This action requires a finding, asset, graph node, or research case ID.')
    : 'This action reviews the current open finding queue and does not need a target ID.';
}

function renderIntelligence() {
  const data = state.intelligence.data;
  // Keep the operator surface responsive when the bridge or investigation
  // worker has accumulated a large history. The API remains the full source;
  // this panel only renders the most recent actionable slice.
  const jobs = latestIntelligenceJobs(intelligenceJobs()).slice(0, 50);
  const pipelineGroups = intelligencePipelineGroups(jobs);
  const bridge = data?.bridge || {};
  const service = data?.service || {};
  const mcp = data?.chatgpt_app || {};
  const localMode = data?.mode === 'local-helper';
  const autopilot = data?.autopilot || {};
  const autopilotSettings = autopilot.settings || {};
  const autopilotSummary = autopilot.summary || {};
  const autopilotRuns = Array.isArray(autopilot.runs) ? autopilot.runs : [];
  const tuningProposals = Array.isArray(autopilot.tuning_proposals) ? autopilot.tuning_proposals : [];
  const investigations = data?.investigations || {};
  const investigationSummary = investigations.summary || {};
  const investigationRuns = Array.isArray(investigations.runs) ? investigations.runs.slice(0, 100) : [];
  const dailyAutomation = data?.daily_automation || {};
  const dailySettings = dailyAutomation.settings || {};
  const dailySummary = dailyAutomation.summary || {};
  const dailyRuns = Array.isArray(dailyAutomation.runs) ? dailyAutomation.runs : [];
  const dailyLatest = dailyRuns[0] || null;
  const learning = data?.learning || {};
  const learningSummary = learning.summary || {};
  const learningSettings = learning.settings || {};
  const learningProposals = Array.isArray(learning.proposals) ? learning.proposals : [];
  const learningDeployments = Array.isArray(learning.deployments) ? learning.deployments : [];
  const learningAdjudicationQueue = Array.isArray(learning.adjudication_queue) ? learning.adjudication_queue : [];
  const recordedCounts = data?.jobs?.counts && typeof data.jobs.counts === 'object' ? data.jobs.counts : {};
  const persistedModel = String(data?.bridge?.selected_model || '').trim();
  const parkedProviderJobs = intelligenceJobs().filter(job => {
    if (String(job?.status || '').toLowerCase() !== 'awaiting_provider' || !persistedModel) return false;
    const captured = String(job?.input?.selected_model || job?.selected_model || '').trim();
    return captured && captured !== persistedModel;
  }).length;
  const counts = Object.keys(recordedCounts).length ? recordedCounts : jobs.reduce((result, job) => {
    const status = String(job?.status || 'unknown');
    result[status] = (result[status] || 0) + 1;
    return result;
  }, {});
  const recordedTotal = Object.values(counts).reduce((total, value) => total + Number(value || 0), 0);

  const summary = el('intelligence-summary');
  if (summary) summary.innerHTML = `
    <div class="metric-card"><div class="metric">${recordedTotal}</div><div class="metric-label">Recorded jobs</div></div>
    <div class="metric-card"><div class="metric">${counts.queued || 0}</div><div class="metric-label">Queued</div></div>
    <div class="metric-card"><div class="metric">${counts.awaiting_provider || 0}</div><div class="metric-label">Awaiting provider</div></div>
    <div class="metric-card"><div class="metric">${counts.running || 0}</div><div class="metric-label">Running</div></div>
    <div class="metric-card"><div class="metric">${counts.failed || 0}</div><div class="metric-label">Failed history</div></div>
    <div class="small" style="grid-column:1/-1;">Counts include durable attempts. Current pipeline rows below are deduplicated; transport failures can be recovered in a bounded pass, while ${parkedProviderJobs ? `${parkedProviderJobs} provider-wait job(s) captured for another model remain parked` : 'jobs captured for another model remain parked'} rather than being silently rerouted.</div>`;

  const bridgePill = el('intelligence-bridge-pill');
  const bridgeDetail = el('intelligence-bridge-detail');
  renderIntelligenceModelSelect();
  const selectedModelLabel = intelligenceSelectedModel() || 'Provider default';
  const providerHealth = bridge.providers && typeof bridge.providers === 'object' ? bridge.providers : {};
  const selectedProvider = bridge.selected_model ? providerHealth[bridge.selected_model] : null;
  const selectedProviderReady = selectedProvider?.status === 'ready';
  const healthStale = bridge.health_stale === true;
  const bridgeBusy = bridge.busy === true || String(bridge.status || '') === 'busy';
  const bridgeDisplayStatus = state.intelligence.loading
    ? 'Checking'
    : (bridgeBusy
      ? 'Busy · lease active'
      : (selectedProviderReady
      ? (healthStale ? 'Ready · stale probe' : 'Ready')
      : (bridge.live_ready ? 'Degraded' : (healthStale ? 'Stale' : humanizeSnake(bridge.status || (data ? 'unavailable' : 'not_checked'))))));
  if (bridgePill) bridgePill.textContent = bridgeDisplayStatus;
  const providerRows = Object.entries(providerHealth).map(([model, item]) => {
    const status = String(item?.status || 'unknown');
    const detail = status === 'ready'
      ? `${item?.http_status ? `HTTP ${item.http_status}; ` : ''}live probe passed${item?.transport_diagnostic ? ` · ${item.transport_diagnostic}` : ''}`
      : (item?.error || 'provider unavailable');
    return `<div class="kv-row"><div class="kv-key">${escapeHtml(model)}</div><div class="kv-val"><strong>${escapeHtml(humanizeSnake(status))}</strong><div class="small">${escapeHtml(detail)}</div></div></div>`;
  }).join('');
  const codex = bridge.codex && typeof bridge.codex === 'object' ? bridge.codex : {};
  const codexStatus = String(codex.status || '').trim();
  const codexLabel = codexStatus === 'ready'
    ? `Ready${codex.version ? ` · ${codex.version}` : ''}`
    : (codexStatus ? humanizeSnake(codexStatus) : (localMode ? 'Unavailable' : 'Runs on local sensor'));
  const healthAge = bridge.snapshot_age_seconds === null || bridge.snapshot_age_seconds === undefined
    ? ''
    : ` · ${formatCoverageLag(bridge.snapshot_age_seconds)} old`;
  const selectedHealthLabel = bridgeBusy
    ? `busy on ${bridge.active_model || bridge.selected_model || selectedModelLabel}; heartbeat lease is current`
    : (selectedProviderReady
      ? (healthStale ? 'last probe passed; refresh pending' : 'live probe passed')
      : (selectedProvider?.error || 'no successful live probe recorded'));
  const activeJobDetail = bridgeBusy
    ? `<div class="kv-row"><div class="kv-key">Active model job</div><div class="kv-val"><strong>${escapeHtml(bridge.active_job_id || 'Processing')}</strong><div class="small">${escapeHtml(humanizeSnake(bridge.active_job_action || 'model analysis'))} · ${escapeHtml(bridge.active_model || bridge.selected_model || selectedModelLabel)}</div></div></div>`
    : '';
  if (bridgeDetail) bridgeDetail.innerHTML = `
    <div class="kv-row"><div class="kv-key">Queue mode</div><div class="kv-val">${escapeHtml(humanizeSnake(bridge.queue_mode || data?.mode || 'unknown'))}</div></div>
    <div class="kv-row"><div class="kv-key">Selected model</div><div class="kv-val">${escapeHtml(selectedModelLabel)}</div></div>
    <div class="kv-row"><div class="kv-key">Model catalog</div><div class="kv-val">${escapeHtml(String(data?.models?.count || 0))} models from OpenCodex</div></div>
    <div class="kv-row"><div class="kv-key">Codex</div><div class="kv-val">${escapeHtml(codexLabel)}</div></div>
    <div class="kv-row"><div class="kv-key">Authentication</div><div class="kv-val">${escapeHtml(humanizeSnake(bridge.authentication_method || (localMode ? 'unknown' : 'local ChatGPT sign-in')))}</div></div>
    <div class="kv-row"><div class="kv-key">Background service</div><div class="kv-val">${escapeHtml(humanizeSnake(service.status || 'unknown'))}</div></div>
    <div class="kv-row"><div class="kv-key">Selected model health</div><div class="kv-val">${escapeHtml(selectedHealthLabel)}${healthAge ? `<div class="small">${escapeHtml(healthAge.replace(/^ · /, ''))}</div>` : ''}</div></div>
    ${activeJobDetail}
    ${providerRows ? `<div class="kv-row"><div class="kv-key">Live providers</div><div class="kv-val"><div class="kv-list">${providerRows}</div></div></div>` : ''}
    <div class="kv-row"><div class="kv-key">ChatGPT credentials</div><div class="kv-val">Codex-owned; never stored by SecOpsAI</div></div>
    ${bridge.message ? `<div class="small" style="margin-top:10px;">${escapeHtml(bridge.message)}</div>` : ''}`;

  const serviceActions = el('intelligence-service-actions');
  if (serviceActions) serviceActions.querySelectorAll('[data-intelligence-service], #intelligence-run-once-btn').forEach(button => {
    button.hidden = !localMode;
  });
  const tokenField = el('intelligence-token-field');
  // All Intelligence POST actions are protected, including hosted helper
  // mode. Keep the field visible so the operator can see where the token goes.
  if (tokenField) tokenField.hidden = false;
  const tokenInput = el('intelligence-admin-token');
  if (tokenInput && tokenInput.value !== state.intelligence.adminToken) tokenInput.value = state.intelligence.adminToken;

  const mcpPill = el('intelligence-mcp-pill');
  if (mcpPill) mcpPill.textContent = mcp.configured ? 'Configured' : 'Setup required';
  const mcpDetail = el('intelligence-mcp-detail');
  if (mcpDetail) mcpDetail.innerHTML = `
    <div class="kv-row"><div class="kv-key">Mode</div><div class="kv-val">Read-only OAuth MCP</div></div>
    <div class="kv-row"><div class="kv-key">Endpoint</div><div class="kv-val">${escapeHtml(mcp.url || 'Not configured in this dashboard')}</div></div>
    <div class="kv-row"><div class="kv-key">Available tools</div><div class="kv-val">9 read-only tools</div></div>
    <div class="kv-row"><div class="kv-key">Write access</div><div class="kv-val">None</div></div>
    <div class="small" style="margin-top:10px;">ChatGPT authenticates the model session. SecOpsAI OAuth separately authorizes workspace data.</div>`;
  const copyMcp = el('intelligence-copy-mcp-btn');
  if (copyMcp) copyMcp.disabled = !mcp.url;

  const output = el('intelligence-service-output');
  if (output) {
    output.hidden = !state.intelligence.serviceOutput;
    output.textContent = state.intelligence.serviceOutput;
  }

  const autopilotPill = el('intelligence-autopilot-pill');
  if (autopilotPill) autopilotPill.textContent = humanizeSnake(autopilotSettings.mode || 'not_configured');
  renderAutopilotModelSelect(autopilotSettings);
  const autopilotMode = el('intelligence-autopilot-mode');
  if (autopilotMode && document.activeElement !== autopilotMode) autopilotMode.value = autopilotSettings.mode || 'advisory';
  const autopilotConfidence = el('intelligence-autopilot-confidence');
  if (autopilotConfidence && document.activeElement !== autopilotConfidence) autopilotConfidence.value = String(autopilotSettings.min_auto_close_confidence || 97);
  const autopilotEvidence = el('intelligence-autopilot-evidence');
  if (autopilotEvidence && document.activeElement !== autopilotEvidence) autopilotEvidence.value = String(autopilotSettings.min_evidence_refs || 2);
  const autopilotLimit = el('intelligence-autopilot-limit');
  if (autopilotLimit && document.activeElement !== autopilotLimit) autopilotLimit.value = String(autopilotSettings.max_records_per_cycle || 10);
  const autopilotTuning = el('intelligence-autopilot-tuning');
  if (autopilotTuning && document.activeElement !== autopilotTuning) autopilotTuning.checked = autopilotSettings.auto_create_tuning_proposals !== false;
  const autopilotActivateTuning = el('intelligence-autopilot-activate-tuning');
  if (autopilotActivateTuning && document.activeElement !== autopilotActivateTuning) autopilotActivateTuning.checked = Boolean(autopilotSettings.auto_activate_tuning);
  const autopilotSummaryEl = el('intelligence-autopilot-summary');
  if (autopilotSummaryEl) autopilotSummaryEl.innerHTML = `
    <div class="metric-card"><div class="metric">${escapeHtml(String(autopilotSummary.awaiting_model || 0))}</div><div class="metric-label">Awaiting model</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(String(autopilotSummary.auto_applied || 0))}</div><div class="metric-label">Auto-closed</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(String(autopilotSummary.escalated || 0))}</div><div class="metric-label">Escalated</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(String(autopilotSummary.tuning_proposals || 0))}</div><div class="metric-label">Tuning proposals</div></div>`;
  const autopilotRunsEl = el('intelligence-autopilot-runs');
  if (autopilotRunsEl) {
    const groupedAutopilot = new Map();
    autopilotRuns.forEach(run => {
      const key = String(run?.target_id || run?.run_id || 'unknown');
      const current = groupedAutopilot.get(key);
      if (!current) groupedAutopilot.set(key, { ...run, repeat_count: 1 });
      else {
        current.repeat_count = Number(current.repeat_count || 1) + 1;
        if (String(run.updated_at || '') > String(current.updated_at || '')) groupedAutopilot.set(key, { ...run, repeat_count: current.repeat_count });
      }
    });
    const recent = [...groupedAutopilot.values()].slice(0, 12);
    autopilotRunsEl.innerHTML = !recent.length
      ? '<div class="empty-state compact">No autonomous triage decisions yet. Enable advisory or guarded mode, then review new findings.</div>'
      : `<div class="table-wrap"><table><thead><tr><th>Finding or alert</th><th>Source</th><th>Decision</th><th>Model assessment</th><th>Guardrail</th><th>Updated</th><th>Action</th></tr></thead><tbody>${recent.map(run => {
          const decision = run.decision || {};
          const target = run.target || {};
          const reasons = Array.isArray(decision.guardrail_reasons) ? decision.guardrail_reasons : [];
          const rollback = ['applied', 'escalated'].includes(String(run.status || ''))
            ? `<button class="mini-btn" data-agent-triage-rollback="${escapeHtml(run.run_id)}" type="button">Rollback</button>`
            : '';
          const source = securitySourceLabel(target.source);
          const context = [target.ecosystem, target.package].filter(Boolean).join(' · ');
          const repeats = Number(run.repeat_count || 1) > 1 ? `<div class="small">${escapeHtml(String(run.repeat_count))} repeated evaluations; showing latest</div>` : '';
          return `<tr><td><strong>${escapeHtml(target.title || run.target_id || 'Unknown')}</strong><div class="small mono">${escapeHtml(run.target_id || '')}</div>${context ? `<div class="small">${escapeHtml(context)}</div>` : ''}${repeats}</td><td>${escapeHtml(source)}</td><td><span class="agent-triage-action">${escapeHtml(humanizeSnake(run.final_action || run.status || 'pending'))}</span></td><td>${escapeHtml(humanizeSnake(decision.model_verdict || 'pending'))}${typeof decision.model_confidence === 'number' ? `<div class="small">${escapeHtml(String(decision.model_confidence))}% confidence</div>` : ''}</td><td class="agent-triage-reasons">${reasons.length ? escapeHtml(humanizeMachineText(reasons.join(' · '))) : '<span class="small">Passed applicable gates</span>'}</td><td>${escapeHtml(fmtDate(run.updated_at))}</td><td>${rollback}</td></tr>`;
        }).join('')}</tbody></table></div>`;
  }
  const autopilotProposalsEl = el('intelligence-autopilot-proposals');
  if (autopilotProposalsEl) {
    const recent = tuningProposals.slice(0, 10);
    autopilotProposalsEl.innerHTML = !recent.length
      ? ''
      : `<div class="module-head compact-header"><div><h4>Detection tuning</h4><p>Model proposals stay in shadow mode until deterministic historical replay proves the exact threshold change.</p></div></div><div class="table-wrap"><table><thead><tr><th>Target</th><th>Change</th><th>Shadow result</th><th>Evidence set</th><th>Action</th></tr></thead><tbody>${recent.map(proposal => {
          const metrics = proposal.shadow_metrics || {};
          const rollback = proposal.status === 'active'
            ? `<button class="mini-btn" data-agent-tuning-rollback="${escapeHtml(proposal.proposal_id)}" type="button">Rollback tuning</button>`
            : '';
          return `<tr><td><strong>${escapeHtml(proposal.target_id || proposal.target_type || 'Unknown')}</strong><div class="small mono">${escapeHtml(proposal.proposal_id || '')}</div></td><td>${escapeHtml(humanizeSnake(proposal.change_type || 'proposal'))}<div class="small">${escapeHtml(compactText(proposal.rationale || '', 180))}</div></td><td>${escapeHtml(humanizeSnake(proposal.status || 'unknown'))}<div class="small">Activation ${metrics.activation_allowed ? 'permitted by replay' : 'blocked'}</div></td><td>${escapeHtml(String(metrics.labeled_findings || 0))} labeled<div class="small">${escapeHtml(String(metrics.reviewed_false_positives || 0))} safe · ${escapeHtml(String(metrics.reviewed_true_positives || 0))} risky</div></td><td>${rollback}</td></tr>`;
        }).join('')}</tbody></table></div>`;
  }

  const investigationSummaryEl = el('investigation-autopilot-summary');
  if (investigationSummaryEl) investigationSummaryEl.innerHTML = `
    <div class="metric-card"><div class="metric">${escapeHtml(String((investigationSummary.collecting || 0) + (investigationSummary.analyzing || 0) + (investigationSummary.running || 0)))}</div><div class="metric-label">Running investigations</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(String(investigationSummary.queued || 0))}</div><div class="metric-label">Queued backlog</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(String(investigationSummary.awaiting_model || 0))}</div><div class="metric-label">Awaiting model</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(String(investigationSummary.escalated || 0))}</div><div class="metric-label">Threats escalated</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(String((investigationSummary.evidence_gap || 0) + (investigationSummary.failed || 0)))}</div><div class="metric-label">Needs recovery</div></div>
    <div class="small" style="grid-column:1/-1;">Counts are one current run per finding. ${escapeHtml(String(investigationSummary.history_total || investigationSummary.total || 0))} historical attempts remain available in the audit trail.</div>`;
  const investigationRunsEl = el('investigation-autopilot-runs');
  if (investigationRunsEl) {
    investigationRunsEl.innerHTML = !investigationRuns.length
      ? '<div class="empty-state compact">No high-priority evidence investigations yet. Eligible high and critical package findings enter this queue automatically.</div>'
      : `<div class="small" style="margin-bottom:8px;">Showing one current investigation per finding; older attempts remain available in the case audit history.</div><div class="table-wrap"><table><thead><tr><th>Finding</th><th>Stage</th><th>Evidence state</th><th>Decision</th><th>Updated</th><th>Recovery</th></tr></thead><tbody>${[
          ...investigationRuns.filter(run => ['failed', 'evidence_gap', 'canceled'].includes(String(run.status || ''))),
          ...investigationRuns.filter(run => !['failed', 'evidence_gap', 'canceled'].includes(String(run.status || ''))),
        ].slice(0, 100).map(run => {
          const decision = run.decision || {};
          const blocker = run.blocker_message ? `<div class="small investigation-blocker">${escapeHtml(humanizeMachineText(run.blocker_message))}</div>` : '';
          const recoveryAvailable = run.recovery_available !== undefined ? Boolean(run.recovery_available) : run.retryable !== false;
          const retry = ['failed', 'evidence_gap', 'canceled'].includes(String(run.status || '')) && recoveryAvailable
            ? `<button class="mini-btn" data-investigation-retry="${escapeHtml(run.run_id)}" type="button">Retry</button>` : '';
          const cancel = ['queued', 'collecting', 'analyzing', 'awaiting_model', 'awaiting_input'].includes(String(run.status || ''))
            ? `<button class="mini-btn" data-investigation-cancel="${escapeHtml(run.run_id)}" type="button">Cancel</button>` : '';
          const openCase = run.case_id ? `<button class="mini-btn" data-investigation-case="${escapeHtml(run.case_id)}" type="button">Open case</button>` : '';
          const history = Number(run.history_count || 1) > 1 ? `<div class="small">${escapeHtml(String(run.history_count))} attempts retained</div>` : '';
          return `<tr><td><strong>${escapeHtml(run.finding_id || 'Unknown')}</strong><div class="small mono">${escapeHtml(run.run_id || '')}</div>${history}</td><td><span class="status-pill">${escapeHtml(humanizeSnake(run.status || 'unknown'))}</span><div class="small">${escapeHtml(humanizeSnake(run.current_stage || 'queued'))}</div></td><td>${run.pipeline_id ? `<span class="mono small">${escapeHtml(run.pipeline_id)}</span>` : '<span class="small">Not started</span>'}${blocker}</td><td>${escapeHtml(humanizeSnake(decision.verdict || 'pending'))}${decision.confidence != null ? `<div class="small">${escapeHtml(String(decision.confidence))}% confidence</div>` : ''}</td><td>${escapeHtml(fmtDate(run.updated_at))}</td><td>${openCase}${retry}${cancel}</td></tr>`;
        }).join('')}</tbody></table></div>`;
  }
  const dailyPill = el('daily-automation-pill');
  if (dailyPill) dailyPill.textContent = humanizeSnake(dailySettings.enabled === false ? 'paused' : (dailySummary.last_status || 'ready'));
  const dailyEnabled = el('daily-automation-enabled');
  if (dailyEnabled && document.activeElement !== dailyEnabled) dailyEnabled.value = dailySettings.enabled === false ? 'off' : 'on';
  const dailyInterval = el('daily-automation-interval');
  if (dailyInterval && document.activeElement !== dailyInterval) dailyInterval.value = String(dailySettings.interval_seconds || 86400);
  const dailyAlertLimit = el('daily-automation-alert-limit');
  if (dailyAlertLimit && document.activeElement !== dailyAlertLimit) dailyAlertLimit.value = String(dailySettings.max_alert_reviews || 25);
  const dailyInvestigationLimit = el('daily-automation-investigation-limit');
  if (dailyInvestigationLimit && document.activeElement !== dailyInvestigationLimit) dailyInvestigationLimit.value = String(dailySettings.max_investigations || 5);
  const dailyCaseLimit = el('daily-automation-case-limit');
  if (dailyCaseLimit && document.activeElement !== dailyCaseLimit) dailyCaseLimit.value = String(dailySettings.max_candidate_cases || 25);
  const dailyPromote = el('daily-automation-promote');
  if (dailyPromote && document.activeElement !== dailyPromote) dailyPromote.checked = dailySettings.auto_promote_candidates !== false;
  const dailyLearning = el('daily-automation-learning');
  if (dailyLearning && document.activeElement !== dailyLearning) dailyLearning.checked = dailySettings.run_learning !== false;
  const dailySummaryEl = el('daily-automation-summary');
  if (dailySummaryEl) dailySummaryEl.innerHTML = `
    <div class="metric-card"><div class="metric">${escapeHtml(String(dailySummary.runs || 0))}</div><div class="metric-label">Recorded cycles</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(String(dailySummary.active || 0))}</div><div class="metric-label">Running now</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(String(dailySummary.recent_failed_steps ?? dailySummary.failed_steps ?? 0))}</div><div class="metric-label">Latest cycle failures</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(fmtDate(dailySummary.next_run_at) || 'Ready')}</div><div class="metric-label">Next scheduled run</div></div>`;
  const dailyStepsEl = el('daily-automation-steps');
  if (dailyStepsEl) {
    const steps = dailyLatest?.steps || [];
    dailyStepsEl.innerHTML = !dailyLatest
      ? '<div class="empty-state compact">No coordinated cycle has run yet. Save the policy, then run the full workflow once.</div>'
      : `<div class="module-head compact-header"><div><h4>Latest cycle</h4><p>${escapeHtml(humanizeSnake(dailyLatest.status || 'unknown'))} · ${escapeHtml(fmtDate(dailyLatest.completed_at || dailyLatest.started_at))} · ${escapeHtml(dailyLatest.run_id || '')}</p></div></div><div class="table-wrap"><table><thead><tr><th>Step</th><th>Status</th><th>Result</th><th>Finished</th></tr></thead><tbody>${steps.map(step => {
        const result = step.result || {};
        const stepStatus = String(step.status || 'unknown').toLowerCase();
        const inProgress = ['queued', 'running'].includes(stepStatus);
        const detail = result.error || result.reason || result.status || (inProgress ? 'In progress' : (stepStatus === 'skipped' ? 'Skipped' : 'Completed'));
        const finished = step.completed_at ? fmtDate(step.completed_at) : (inProgress ? 'In progress' : '—');
        return `<tr><td><strong>${escapeHtml(humanizeSnake(step.step_name || 'step'))}</strong></td><td><span class="status-pill">${escapeHtml(humanizeSnake(stepStatus))}</span></td><td>${escapeHtml(compactText(String(detail), 180))}</td><td>${escapeHtml(finished)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }
  const learningSummaryEl = el('detection-learning-summary');
  const awaitingAdjudication = Number.isFinite(Number(learningSummary.awaiting_adjudication))
    ? Number(learningSummary.awaiting_adjudication)
    : null;
  const learningDeploymentIsStale = deployment => {
    const observations = deployment?.observations || {};
    const observed = ['tp', 'fp', 'tn', 'fn'].reduce((total, key) => total + Number(observations[key] || 0), 0);
    const updatedAt = Date.parse(String(deployment?.updated_at || deployment?.started_at || ''));
    return deployment?.status === 'running' && observed === 0 && Number.isFinite(updatedAt) && Date.now() - updatedAt > 7 * 24 * 60 * 60 * 1000;
  };
  const activeLearningEvaluations = new Set(learningDeployments.filter(item => item.status === 'running' && !learningDeploymentIsStale(item)).map(item => item.proposal_id).filter(Boolean)).size;
  const staleLearningEvaluations = new Set(learningDeployments.filter(learningDeploymentIsStale).map(item => item.proposal_id).filter(Boolean)).size;
  if (learningSummaryEl) learningSummaryEl.innerHTML = `
    <div class="metric-card"><div class="metric">${escapeHtml(String(learningSummary.feedback_total || 0))}</div><div class="metric-label">Feedback records</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(String(learningSummary.examples || 0))}</div><div class="metric-label">Trusted examples</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(awaitingAdjudication === null ? '—' : String(awaitingAdjudication))}</div><div class="metric-label">Subjects needing evidence</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(String(learningSummary.experiments || 0))}</div><div class="metric-label">Recorded evaluations</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(String(activeLearningEvaluations))}</div><div class="metric-label">Active evaluations</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(String(staleLearningEvaluations))}</div><div class="metric-label">Stale evaluations</div></div>
    <div class="metric-card"><div class="metric">${escapeHtml(String(learningSummary.blocked || 0))}</div><div class="metric-label">Rejected evaluations</div></div>`;

  const formatLearningRate = value => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Not measured';
    return `${(Number(value) * 100).toFixed(2).replace(/\.00$/, '')}%`;
  };
  const learningProposalReasons = proposal => {
    const guardrails = proposal?.guardrails || {};
    const holdout = proposal?.replay_metrics?.holdout || {};
    const reasons = [];
    if (guardrails.enough_examples === false) reasons.push('The minimum trusted-example requirement was not met.');
    if (guardrails.both_labels === false) reasons.push('Both risky and benign evidence-backed labels are required.');
    if (guardrails.holdout_evaluable === false) reasons.push('The holdout set cannot measure both precision and recall yet.');
    if (guardrails.precision_pass === false) reasons.push(`Precision ${formatLearningRate(holdout.precision)} is below the ${formatLearningRate(learningSettings.minimum_precision)} safety gate.`);
    if (guardrails.false_negative_regression_pass === false) reasons.push(`False negatives ${Number(holdout.fn || 0)} exceed the allowed maximum of ${Number(learningSettings.maximum_false_negative_regression || 0)}.`);
    if (Number(holdout.false_positive_rate) === 1 && Number(holdout.tn || 0) === 0 && Number(holdout.fp || 0) > 0) reasons.push('The ranker marked every benign holdout example as risky: 100% false-positive rate and zero true negatives.');
    if (!reasons.length && proposal?.status === 'blocked') reasons.push('This evaluation did not pass every configured safety guardrail.');
    return reasons;
  };

  const currentLearningEl = el('detection-learning-current');
  const currentLearningProposal = learningProposals[0] || null;
  if (currentLearningEl) {
    if (!currentLearningProposal) {
      currentLearningEl.innerHTML = '<div class="empty-state compact">No learning evaluation exists yet. A cycle needs evidence-backed risky and benign examples before it can produce a candidate.</div>';
    } else {
      const currentHoldout = currentLearningProposal.replay_metrics?.holdout || {};
      const currentReasons = learningProposalReasons(currentLearningProposal);
      const blocked = currentLearningProposal.status === 'blocked';
      const nextStage = currentLearningProposal.status === 'shadow_ready' ? 'shadow' : (currentLearningProposal.status === 'shadow' ? 'canary' : (currentLearningProposal.status === 'canary' ? 'active' : ''));
      const riskyExamples = Number(learningSummary.example_by_label?.true_positive || 0);
      const benignExamples = Number(learningSummary.example_by_label?.false_positive || 0);
      const nextAction = blocked
        ? (Number(currentHoldout.false_positive_rate) === 1 && Number(currentHoldout.tn || 0) === 0
          ? 'Review unresolved findings and add trustworthy benign outcomes. Improve the ranker or feature set, then rerun evaluation. Do not lower the safety threshold to force promotion.'
          : 'Resolve the listed evidence or quality gap, then rerun the learning cycle. Do not promote this proposal manually.')
        : (nextStage ? `Review the holdout evidence, then explicitly promote this candidate to ${nextStage} if the result remains acceptable.` : 'Continue monitoring reviewed observations and retain the audit trail.');
      currentLearningEl.innerHTML = `<section class="intelligence-decision-card detection-learning-decision" aria-label="Current learning assessment">
        <div class="intelligence-decision-card-head"><div><span class="eyebrow">Current assessment</span><strong>${escapeHtml(blocked ? 'Rejected by safety guardrails' : humanizeSnake(currentLearningProposal.status || 'unknown'))}</strong><p>${escapeHtml(blocked ? 'No production detector changed. This candidate remains inert because its measured quality is not safe enough.' : 'This candidate is evidence-backed and remains subject to explicit replay, shadow, canary, and activation controls.')}</p></div><span class="decision-card-badge">${escapeHtml(humanizeSnake(currentLearningProposal.status || 'unknown'))}</span></div>
        <div class="metrics-grid compact-metrics learning-decision-metrics">
          <div class="metric-card"><div class="metric">${escapeHtml(formatLearningRate(currentHoldout.precision))}</div><div class="metric-label">Detection precision</div></div>
          <div class="metric-card"><div class="metric">${escapeHtml(formatLearningRate(currentHoldout.recall))}</div><div class="metric-label">Detection recall</div></div>
          <div class="metric-card"><div class="metric">${escapeHtml(formatLearningRate(currentHoldout.false_positive_rate))}</div><div class="metric-label">False-positive rate</div></div>
          <div class="metric-card"><div class="metric">${escapeHtml(String(currentHoldout.tn ?? '—'))}</div><div class="metric-label">True negatives</div></div>
        </div>
        <div class="intelligence-decision-columns"><div><h4>Confirmed facts</h4><ul><li>Holdout: TP ${escapeHtml(String(currentHoldout.tp || 0))}, FP ${escapeHtml(String(currentHoldout.fp || 0))}, TN ${escapeHtml(String(currentHoldout.tn || 0))}, FN ${escapeHtml(String(currentHoldout.fn || 0))}.</li><li>Training balance: ${escapeHtml(String(riskyExamples))} risky and ${escapeHtml(String(benignExamples))} benign trusted examples.</li><li>Required precision: ${escapeHtml(formatLearningRate(learningSettings.minimum_precision))}; allowed false-negative regression: ${escapeHtml(String(learningSettings.maximum_false_negative_regression ?? 0))}.</li></ul></div><div><h4>Why this decision</h4>${currentReasons.length ? `<ul>${currentReasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : '<p>Every configured offline gate passed.</p>'}</div><div><h4>Next action</h4><p>${escapeHtml(nextAction)}</p>${nextStage ? `<button class="primary-btn mini-btn" data-learning-deploy="${escapeHtml(currentLearningProposal.proposal_id)}" data-learning-stage="${escapeHtml(nextStage)}" type="button">Promote to ${escapeHtml(nextStage)}</button>` : ''}</div></div>
      </section>`;
    }
  }

  const learningAdjudicationEl = el('detection-learning-adjudication');
  if (learningAdjudicationEl) {
    const historicalUnknown = Number(learningSummary.feedback_by_outcome?.unknown || 0);
    const resolvedUnknown = Number(learningSummary.resolved_unknown_subjects || 0);
    const queueIntro = awaitingAdjudication === null
      ? 'The helper has not provided a subject-level adjudication count yet.'
      : `${awaitingAdjudication} distinct subject${awaitingAdjudication === 1 ? '' : 's'} still need an evidence-backed decision. ${historicalUnknown} immutable unknown feedback record${historicalUnknown === 1 ? '' : 's'} remain in the audit log; ${resolvedUnknown} previously unknown subject${resolvedUnknown === 1 ? '' : 's'} have since been resolved.`;
    learningAdjudicationEl.innerHTML = `<div class="module-head compact-header"><div><h4>Evidence decisions needed</h4><p>${escapeHtml(queueIntro)}</p></div></div>${!learningAdjudicationQueue.length
      ? '<div class="empty-state compact">No unresolved subject details were returned. Refresh after updating the local helper if the summary still shows pending subjects.</div>'
      : `<div class="table-wrap"><table><thead><tr><th>Subject</th><th>Available evidence</th><th>Signals</th><th>Last observed</th><th>Action</th></tr></thead><tbody>${learningAdjudicationQueue.map(item => `<tr><td><strong>${escapeHtml(item.subject_key || item.finding_id || 'Unknown')}</strong>${item.finding_id ? `<div class="small mono">${escapeHtml(item.finding_id)}</div>` : ''}</td><td>${escapeHtml(String(item.evidence_ref_count || 0))} reference${Number(item.evidence_ref_count || 0) === 1 ? '' : 's'}</td><td>${escapeHtml((item.active_features || []).map(humanizeSnake).join(' · ') || 'No scoring features recorded')}</td><td>${escapeHtml(fmtDate(item.created_at))}</td><td>${item.finding_id ? `<button class="mini-btn" data-learning-review-finding="${escapeHtml(item.finding_id)}" type="button">Review finding</button>` : '<span class="small">Open the matching case or finding and record an evidence-backed outcome.</span>'}</td></tr>`).join('')}</tbody></table></div><div class="small learning-queue-note">Showing the newest ${escapeHtml(String(learningAdjudicationQueue.length))} unresolved subjects. Historical feedback remains preserved for audit.</div>`}`;
  }

  const learningProposalGroups = [];
  const learningProposalGroupMap = new Map();
  learningProposals.forEach(proposal => {
    const holdout = proposal.replay_metrics?.holdout || {};
    const policy = proposal.parameters?.policy || {};
    const key = proposal.parameters?.policy_fingerprint || [proposal.status, proposal.dataset_id, holdout.tp, holdout.fp, holdout.tn, holdout.fn, holdout.precision, holdout.recall, policy.minimum_precision, policy.maximum_false_negative_regression].join('|');
    const existing = learningProposalGroupMap.get(key);
    if (existing) existing.count += 1;
    else {
      const group = { proposal, count: 1 };
      learningProposalGroupMap.set(key, group);
      learningProposalGroups.push(group);
    }
  });
  const learningProposalsEl = el('detection-learning-proposals');
  if (learningProposalsEl) learningProposalsEl.innerHTML = !learningProposals.length
    ? ''
    : `<details class="detection-learning-history"><summary>Evaluation history (${escapeHtml(String(learningSummary.proposals || learningProposals.length))} recorded; ${escapeHtml(String(learningProposalGroups.length))} distinct recent result${learningProposalGroups.length === 1 ? '' : 's'})</summary><div class="table-wrap"><table><thead><tr><th>Evaluation</th><th>Decision</th><th>Holdout quality</th><th>Why / action</th></tr></thead><tbody>${learningProposalGroups.slice(0, 12).map(group => {
        const p = group.proposal;
        const holdout = p.replay_metrics?.holdout || {};
        const evaluationStatus = String(p.replay_metrics?.evaluation_status || p.parameters?.evaluation_status || '').toLowerCase();
        const insufficient = evaluationStatus === 'insufficient_data'
          || (Number(holdout.tp || 0) + Number(holdout.fp || 0) === 0)
          || (Number(holdout.tp || 0) + Number(holdout.fn || 0) === 0);
        const next = p.status === 'shadow_ready' ? 'shadow' : (p.status === 'shadow' ? 'canary' : (p.status === 'canary' ? 'active' : ''));
        const holdoutCell = insufficient
          ? 'Insufficient data<div class="small">Precision and recall are undefined until the holdout contains both required observations.</div>'
          : `${escapeHtml(formatLearningRate(holdout.precision))} precision<div class="small">${escapeHtml(formatLearningRate(holdout.recall))} recall · ${escapeHtml(formatLearningRate(holdout.false_positive_rate))} false-positive rate · ${escapeHtml(String(holdout.fn || 0))} FN</div>`;
        const reasons = learningProposalReasons(p);
        const action = next
          ? `<button class="mini-btn" data-learning-deploy="${escapeHtml(p.proposal_id)}" data-learning-stage="${escapeHtml(next)}" type="button">Promote to ${escapeHtml(next)}</button>`
          : (['shadow','canary','active'].includes(p.status)
            ? `<button class="mini-btn" data-learning-rollback="${escapeHtml(p.proposal_id)}" type="button">Rollback</button>`
            : '<span class="small">No activation action. Improve evidence or model quality.</span>');
        return `<tr><td><strong>${escapeHtml(humanizeSnake(p.proposal_type || 'risk_ranker'))}</strong><div class="small mono">${escapeHtml(p.proposal_id || '')}</div>${group.count > 1 ? `<div class="small">Same result repeated ${escapeHtml(String(group.count))} cycles</div>` : ''}</td><td><span class="status-pill">${escapeHtml(p.status === 'blocked' ? 'Rejected by guardrails' : humanizeSnake(p.status || 'unknown'))}</span></td><td>${holdoutCell}</td><td>${reasons.length ? `<div class="small">${reasons.map(escapeHtml).join('<br>')}</div>` : ''}${action}</td></tr>`;
      }).join('')}</tbody></table></div></details>`;
  const learningDeploymentsEl = el('detection-learning-deployments');
  if (learningDeploymentsEl) learningDeploymentsEl.innerHTML = learningDeployments.length
    ? `<h5>Staged evaluation observations</h5><p class="small">Shadow and canary records are validation stages, not proof that a ranker is effective. A stale row has received no reviewed observations for more than seven days.</p><div class="table-wrap"><table><thead><tr><th>Stage</th><th>Traffic</th><th>Observed</th><th>Status</th><th>Action</th></tr></thead><tbody>${learningDeployments.slice(0,10).map(d => {
        const stale = learningDeploymentIsStale(d);
        return `<tr><td>${escapeHtml(humanizeSnake(d.stage || ''))}<div class="small mono">${escapeHtml(d.deployment_id || '')}</div></td><td>${escapeHtml(String(d.traffic_percent || 0))}%</td><td>TP ${escapeHtml(String(d.observations?.tp || 0))} · FP ${escapeHtml(String(d.observations?.fp || 0))} · TN ${escapeHtml(String(d.observations?.tn || 0))} · FN ${escapeHtml(String(d.observations?.fn || 0))}</td><td><span class="status-pill">${escapeHtml(stale ? 'Stale evaluation' : humanizeSnake(d.status || ''))}</span>${stale ? `<div class="small">No reviewed observations since ${escapeHtml(fmtDate(d.updated_at || d.started_at))}.</div>` : ''}</td><td>${d.status === 'running' ? `<button class="mini-btn" data-learning-rollback="${escapeHtml(d.proposal_id)}" type="button">Stop and retain audit</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>` : '';

  const table = el('intelligence-jobs-table');
  if (table) {
    if (state.intelligence.loading && !data) {
      table.innerHTML = '<div class="empty-state compact">Loading intelligence status…</div>';
    } else if (state.intelligence.error && !jobs.length) {
      table.innerHTML = `<div class="error">${escapeHtml(state.intelligence.error)}</div>`;
    } else if (!jobs.length) {
      table.innerHTML = '<div class="empty-state compact">No analysis jobs yet. Queue an approved action above.</div>';
    } else {
      table.innerHTML = `<div class="intelligence-pipeline-list" role="list" aria-label="Analysis job pipelines">${pipelineGroups.map(group => {
        const current = group.current || {};
        const currentResult = intelligenceResultView(current);
        const stageSummary = group.jobs.map(job => {
          const status = String(job.status || 'pending').toLowerCase();
          const marker = ['succeeded', 'completed'].includes(status) ? '✓' : ['running', 'awaiting_provider'].includes(status) ? '•' : status === 'failed' ? '!' : '○';
          return `<span class="intelligence-stage stage-${escapeHtml(status)}" title="${escapeHtml(humanizeSnake(status))}">${marker} ${escapeHtml(intelligenceStageLabel(job.action))}</span>`;
        }).join('');
        const childRows = group.jobs.map(job => {
          const resultView = intelligenceResultView(job);
          const hasResult = Boolean(job.result_available || resultView.summary || resultView.confirmedFacts.length || resultView.publicationRisks.length || job.error_message);
          const cancel = ['queued', 'awaiting_provider'].includes(String(job.status || '')) ? `<button class="mini-btn" data-intelligence-cancel="${escapeHtml(job.job_id)}" type="button">Cancel</button>` : '';
          const requeue = String(job.status || '') === 'failed' ? `<button class="mini-btn" data-intelligence-requeue="${escapeHtml(job.job_id)}" type="button">Requeue</button>` : '';
          return `<div class="intelligence-child-job"><span><strong>${escapeHtml(intelligenceStageLabel(job.action))}</strong> · <code>${escapeHtml(job.job_id || '')}</code> · ${escapeHtml(humanizeSnake(job.status || 'unknown'))}</span><span>${hasResult ? `<button class="secondary-btn mini-btn" data-intelligence-review="${escapeHtml(job.job_id)}" type="button">Open full analysis</button>` : '<span class="small">Pending</span>'}${cancel}${requeue}</span></div>`;
        }).join('');
        const next = group.status === 'failed' ? 'Requeue failed stage' : group.status === 'completed' ? 'Review completed pipeline' : 'Monitor active stage';
        const retainedAttempts = group.jobs.reduce((total, job) => total + Math.max(1, Number(job.history_count || 1)), 0);
        const historyNote = retainedAttempts > group.total ? ` · ${retainedAttempts} attempts retained` : '';
        const pipelineReference = group.pipelineId || group.target;
        return `<article class="intelligence-pipeline-card" role="listitem">
          <header class="intelligence-pipeline-card-head">
            <div class="intelligence-pipeline-identity"><span class="intelligence-pipeline-label">${escapeHtml(intelligencePipelineLabel(group))}</span><code>${escapeHtml(pipelineReference)}</code><span class="small">Target <code>${escapeHtml(group.target)}</code></span></div>
            ${renderStatusPill(group.status || 'pending')}
          </header>
          <div class="intelligence-pipeline-card-grid">
            <div class="intelligence-pipeline-field intelligence-pipeline-stages"><span class="intelligence-pipeline-label">Stage progress</span><strong>${escapeHtml(String(group.completed))} of ${escapeHtml(String(group.total))} complete</strong><div class="intelligence-stage-list">${stageSummary}</div></div>
            <div class="intelligence-pipeline-field"><span class="intelligence-pipeline-label">Provider</span><code>${escapeHtml(current.provider || 'Not recorded')}</code></div>
            <div class="intelligence-pipeline-field"><span class="intelligence-pipeline-label">Assessment</span><strong>${currentResult.assessment ? escapeHtml(humanizeSnake(currentResult.assessment)) : 'Advisory run'}</strong></div>
            <div class="intelligence-pipeline-field"><span class="intelligence-pipeline-label">Updated</span><time>${escapeHtml(fmtDate(current.updated_at || current.queued_at))}</time></div>
          </div>
          <footer class="intelligence-pipeline-card-footer">
            <details class="intelligence-child-jobs"><summary>${group.total} stage${group.total === 1 ? '' : 's'}${escapeHtml(historyNote)}</summary>${childRows}</details>
            <div class="intelligence-pipeline-next"><span><span class="intelligence-pipeline-label">Next action</span><strong class="intelligence-pipeline-next-copy">${escapeHtml(next)}</strong></span>${currentResult.summary ? `<button class="secondary-btn mini-btn" data-intelligence-review="${escapeHtml(current.job_id)}" type="button">Open latest analysis</button>` : ''}</div>
          </footer>
        </article>`;
      }).join('')}</div>`;
    }
  }
  syncIntelligenceTarget();
}

async function loadIntelligence({ render = true } = {}) {
  state.intelligence.loading = true;
  if (render) renderIntelligence();
  try {
    const response = await dashboardApiFetch(cfg.intelligenceEndpoint || '/api/secopsai/intelligence');
    const payload = await response.json().catch(() => ({}));
    state.intelligence.data = payload;
    state.intelligence.error = response.ok ? null : (payload.error || `Intelligence status HTTP ${response.status}`);
  } catch (error) {
    state.intelligence.error = error?.message || String(error);
  } finally {
    state.intelligence.loading = false;
    if (render) renderIntelligence();
    if (currentPageFromLocation() === 'mission-control') renderMissionControl();
  }
  return state.intelligence.data;
}

async function runIntelligenceAction(action, payload = {}, button = null) {
  const tokenInput = el('intelligence-admin-token');
  state.intelligence.adminToken = tokenInput?.value?.trim() || state.intelligence.adminToken;
  if (!state.intelligence.adminToken) {
    showToast('Enter the Automation action token in Administration → Automation before using this action.', 'error');
    tokenInput?.focus();
    return null;
  }
  if (state.intelligence.adminToken) sessionStorage.setItem('secopsai_intelligence_admin_token', state.intelligence.adminToken);
  setButtonBusy(button, true, 'Working…');
  try {
    const response = await dashboardApiFetch(cfg.intelligenceEndpoint || '/api/secopsai/intelligence', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(state.intelligence.adminToken ? { 'X-SecOpsAI-Intelligence-Token': state.intelligence.adminToken } : {})
      },
      body: JSON.stringify({ action, ...payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      if (result.code === 'intelligence_action_unauthorized') {
        tokenInput?.focus();
      }
      throw new Error(result.error || `Intelligence action HTTP ${response.status}`);
    }
    state.intelligence.serviceOutput = ['service', 'run-once'].includes(action) ? JSON.stringify(result.result || result, null, 2) : state.intelligence.serviceOutput;
    showToast(`Intelligence action completed: ${humanizeSnake(action)}`, 'success');
    const intelligenceJobId = String(
      result?.result?.job_id || result?.result?.job?.job_id || result?.job_id || ''
    ).trim();
    const backgroundAction = ['enqueue', 'autopilot-run-now', 'investigation-run-due', 'recover-transient-jobs'].includes(action);
    await refreshAfterAction({
      key: `intelligence:${action}:${intelligenceJobId || 'workspace'}`,
      poll: backgroundAction,
      isComplete: () => {
        if (!intelligenceJobId) return false;
        const jobRows = state.intelligence.data?.jobs?.jobs || [];
        const job = jobRows.find(item => String(item.job_id || '') === intelligenceJobId);
        return Boolean(job && !['queued', 'running'].includes(String(job.status || '').toLowerCase()));
      },
      onTimeout: () => showToast('The intelligence action is still running. The console will continue updating in the background.', 'info', 6000)
    });
    return result;
  } catch (error) {
    showToast(error?.message || String(error), 'error');
    state.intelligence.error = error?.message || String(error);
    renderIntelligence();
    return null;
  } finally {
    setButtonBusy(button, false);
  }
}

function blogOpsEndpoint(path = '') {
  const base = String(cfg.blogOpsEndpoint || '/api/blog').replace(/\/+$/, '');
  return `${base}${path ? `/${path.replace(/^\/+/, '')}` : ''}`;
}

function blogOpsHeaders({ write = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (write && state.blogOps.adminToken) {
    headers['X-Blog-Ops-Admin-Token'] = state.blogOps.adminToken;
  }
  return headers;
}

async function fetchBlogOpsJson(path = '', options = {}) {
  const isWrite = options.method && String(options.method).toUpperCase() !== 'GET';
  const res = await dashboardApiFetch(blogOpsEndpoint(path), {
    ...options,
    headers: {
      ...blogOpsHeaders({ write: isWrite }),
      ...(options.headers || {})
    }
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const parts = [payload.error || `Blog Ops HTTP ${res.status}`];
    if (payload.hint) parts.push(payload.hint);
    throw new Error(parts.filter(Boolean).join(' '));
  }
  return payload;
}

function blogOpsDrafts() {
  return sortLatestFirst(state.blogOps.drafts, BLOG_DRAFT_LATEST_FIELDS);
}

function selectedBlogDraftSummary() {
  const slug = String(state.blogOps.selectedSlug || '');
  return blogOpsDrafts().find(draft => String(draft.slug || '') === slug) || null;
}

function syncSelectedBlogDraftAfterStatusLoad() {
  const summary = selectedBlogDraftSummary();
  if (!summary) {
    state.blogOps.selectedDraft = null;
    return;
  }
  if (state.blogOps.selectedDraft && String(state.blogOps.selectedDraft.slug || '') === String(summary.slug || '')) {
    state.blogOps.selectedDraft = { ...state.blogOps.selectedDraft, ...summary };
  }
}

function blogDraftFilterValue() {
  return el('blog-draft-filter')?.value || 'all';
}

function filteredBlogDrafts() {
  const filter = blogDraftFilterValue();
  const stream = el('blog-content-filter')?.value || 'all';
  return sortLatestFirst(
    blogOpsDrafts().filter(draft => {
      if (filter !== 'all' && String(draft.review_status || '') !== filter) return false;
      if (stream !== 'all' && blogDraftContentKind(draft) !== stream) return false;
      return true;
    }),
    BLOG_DRAFT_LATEST_FIELDS
  );
}

function blogDraftContentKind(draft = {}) {
  const explicit = String(draft.content_type || draft.kind || draft.source_type || '').toLowerCase();
  if (explicit.includes('advisory')) return 'advisories';
  if (explicit.includes('research')) return 'research';
  if (draft.research_case_id || draft.case_id || draft.research_case) return 'research';
  const categories = Array.isArray(draft.categories) ? draft.categories.map(String).join(' ').toLowerCase() : String(draft.categories || '').toLowerCase();
  if (/advisory/.test(categories)) return 'advisories';
  if (/research|malware|supply.?chain/.test(categories)) return 'research';
  return 'news';
}

function renderReadinessPill(draft = {}) {
  const missing = typeof draft.readiness_status === 'undefined' || draft.readiness_status === null || draft.readiness_status === '';
  const status = missing ? 'not scored' : statusLabel(draft.readiness_status);
  const score = Number(draft.readiness_score || 0);
  const statusClass = String(draft.readiness_status || 'not-scored').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const label = missing ? 'Evidence not scored' : `Evidence ${status} · ${score}`;
  return `<span class="readiness-pill ${escapeHtml(statusClass)}">${escapeHtml(label)}</span>`;
}

function compactValues(values, limit = 6) {
  return Array.isArray(values) ? values.filter(Boolean).slice(0, limit) : [];
}

function renderCompactChips(values, empty = 'None found') {
  const items = compactValues(values);
  if (!items.length) return `<div class="blog-empty-value">${escapeHtml(empty)}</div>`;
  return `<div class="blog-chip-list">${items.map(item => `<span class="mini-chip">${escapeHtml(item)}</span>`).join('')}</div>`;
}

function renderBulletList(values, empty = 'None') {
  const items = compactValues(values, 10);
  if (!items.length) return `<p class="small">${escapeHtml(humanizeMachineText(empty))}</p>`;
  return `<ul class="blog-blocker-list">${items.map(item => `<li>${escapeHtml(humanizeMachineText(item))}</li>`).join('')}</ul>`;
}

function blogOpsAdminTokenHint() {
  return state.blogOps.adminToken ? 'Token ready for write actions' : 'Paste admin token to enable write actions';
}

function blogOpsCapabilities() {
  const status = state.blogOps.status || {};
  return status.capabilities || status.config?.capabilities || {};
}

function isLocalBlogOpsMode() {
  const status = state.blogOps.status || {};
  const mode = String(status.mode || status.config?.mode || '').toLowerCase();
  return Boolean(status.local_helper || blogOpsCapabilities().local_cli || mode.includes('local'));
}

function canDeployFromBlogOps() {
  const caps = blogOpsCapabilities();
  return caps.deploy !== false;
}

function canAttachSourceMediaFromBlogOps() {
  return isLocalBlogOpsMode();
}

function blogOpsWriteActionCopy(status = state.blogOps.status || {}) {
  if (status.configured === false) {
    return 'Hosted Blog Ops needs BLOG_OPS_GITHUB_TOKEN before write actions can dispatch GitHub Actions.';
  }
  if (isLocalBlogOpsMode()) {
    if (canDeployFromBlogOps()) {
      return 'Publish approved writes approved drafts into blog/posts and rebuilds feeds while keeping them Approved. Deploy blog pushes the current blog directory to Cloudflare Pages and then moves staged approved drafts to Deployed.';
    }
    return 'Publish approved writes approved drafts into blog/posts and rebuilds feeds while keeping them Approved. Deploy is unavailable in this helper session, so use hosted Blog Ops or the Cloudflare workflow to deploy and move staged drafts to Deployed.';
  }
  return 'Publish approved dispatches the protected workflow to write approved drafts into blog/posts and rebuild feeds while keeping them Approved. Deploy blog is the separate Cloudflare deployment action that moves staged drafts to Deployed after success.';
}

async function loadBlogOpsStatus({ render = true } = {}) {
  try {
    const payload = await fetchBlogOpsJson('status');
    state.blogOps.status = payload;
    state.blogOps.drafts = sortLatestFirst(payload.drafts || [], BLOG_DRAFT_LATEST_FIELDS);
    state.blogOps.runs = sortLatestFirst(payload.runs || [], BLOG_RUN_LATEST_FIELDS);
    const selectedStillVisible = state.blogOps.drafts.some(draft => String(draft.slug || '') === String(state.blogOps.selectedSlug || ''));
    if ((!state.blogOps.selectedSlug || !selectedStillVisible) && state.blogOps.drafts[0]) {
      state.blogOps.selectedSlug = state.blogOps.drafts[0].slug;
    } else if (!state.blogOps.drafts.length) {
      state.blogOps.selectedSlug = null;
    }
    syncSelectedBlogDraftAfterStatusLoad();
  } catch (error) {
    state.blogOps.status = { ok: false, error: error.message, drafts: [], runs: [] };
    state.blogOps.drafts = [];
    state.blogOps.runs = [];
  }
  if (render) renderBlogOps();
}

async function loadBlogDraft(slug) {
  if (!slug) return null;
  const payload = await fetchBlogOpsJson(`drafts/${encodeURIComponent(slug)}`);
  state.blogOps.selectedSlug = payload.draft?.slug || slug;
  state.blogOps.selectedDraft = payload.draft || null;
  renderBlogOps();
  return state.blogOps.selectedDraft;
}

async function runBlogOpsAction(action, { draft = null, note = '', button = null, payload = {} } = {}) {
  if (action === 'deploy' && !canDeployFromBlogOps()) {
    const message = 'Deploy blog is unavailable in this dashboard mode. Open hosted Blog Ops or run the Cloudflare deployment workflow from GitHub Actions.';
    setStatus(message, true);
    notifyError(message);
    return;
  }
  if (state.blogOps.status?.configured === false) {
    const message = 'Blog Ops is not connected to GitHub yet. Add BLOG_OPS_GITHUB_TOKEN to the Cloudflare Pages project, then refresh Blog Ops.';
    setStatus(message, true);
    notifyError(message);
    return;
  }
  if (!state.blogOps.adminToken) {
    const message = 'Paste your Blog Ops admin token, then click Use token before running write actions.';
    setStatus(message, true);
    notifyError(message);
    return;
  }
  const actionPath = draft ? `drafts/${encodeURIComponent(draft)}/${action}` : action;
  const limit = Number(el('blog-action-limit')?.value || 5) || 5;
  setButtonBusy(button, true, 'Dispatching…');
  try {
    const result = await fetchBlogOpsJson(actionPath, {
      method: 'POST',
      body: JSON.stringify({ limit, note, ...payload })
    });
    state.blogOps.lastAction = { action, draft, payload: result, at: new Date().toISOString() };
    setStatus(`<span class="dot"></span> Blog Ops dispatched ${escapeHtml(action)} via ${escapeHtml(result.workflow || 'workflow')}`);
    await loadBlogOpsStatus({ render: false });
    if (draft) {
      await loadBlogDraft(draft);
    } else {
      renderBlogOps();
    }
    await refreshAfterAction({
      key: `blog:${action}:${draft || 'workspace'}`,
      poll: ['deploy', 'publish', 'news-run', 'news-fetch'].includes(action),
      maxMs: 5 * 60 * 1000,
      onTimeout: () => showToast('The publication workflow is still running. This page will continue updating while it completes.', 'info', 6000)
    });
  } catch (error) {
    const suffix = /unauthorized/i.test(error.message) ? ' Check that the token matches BLOG_OPS_ADMIN_TOKEN in Cloudflare Pages.' : '';
    setStatus(`Blog Ops ${action} failed: ${error.message}${suffix}`, true);
    notifyError(`Blog Ops ${action} failed: ${error.message}${suffix}`);
  } finally {
    setButtonBusy(button, false);
  }
}

function blogEditListText(values) {
  return Array.isArray(values) ? values.filter(Boolean).join('\n') : String(values || '');
}

async function openBlogEditModal(slug) {
  let draft = state.blogOps.selectedDraft;
  if (!draft || String(draft.slug || '') !== String(slug || '') || !draft.body_markdown) {
    draft = await loadBlogDraft(slug || state.blogOps.selectedSlug);
  }
  if (!draft) {
    setStatus('Select a blog draft before editing.', true);
    return;
  }
  state.blogOps.editingSlug = draft.slug;
  if (el('blog-edit-title')) el('blog-edit-title').value = draft.title || '';
  if (el('blog-edit-summary')) el('blog-edit-summary').value = draft.summary || '';
  if (el('blog-edit-severity')) el('blog-edit-severity').value = String(draft.severity || 'info').toLowerCase();
  if (el('blog-edit-categories')) el('blog-edit-categories').value = blogEditListText(draft.categories || []);
  if (el('blog-edit-references')) el('blog-edit-references').value = blogEditListText(draft.references || draft.sources || []);
  if (el('blog-edit-body')) el('blog-edit-body').value = draft.body_markdown || '';
  if (el('blog-edit-note')) el('blog-edit-note').value = '';
  el('blog-edit-modal')?.classList.remove('hidden');
}

function closeBlogEditModal() {
  el('blog-edit-modal')?.classList.add('hidden');
}

async function saveBlogDraftEdit(button = null) {
  const slug = state.blogOps.editingSlug || state.blogOps.selectedSlug;
  if (!slug) {
    setStatus('Select a blog draft before saving edits.', true);
    return;
  }
  const payload = {
    title: el('blog-edit-title')?.value || '',
    summary: el('blog-edit-summary')?.value || '',
    severity: el('blog-edit-severity')?.value || 'info',
    categories: el('blog-edit-categories')?.value || '',
    references: el('blog-edit-references')?.value || '',
    body_markdown: el('blog-edit-body')?.value || ''
  };
  const note = el('blog-edit-note')?.value || 'Edited from Blog Ops dashboard';
  await runBlogOpsAction('save', { draft: slug, note, button, payload });
  closeBlogEditModal();
}

function renderBlogOpsStats() {
  const host = el('blog-ops-stats');
  if (!host) return;
  const status = state.blogOps.status || {};
  const counts = status.counts || {};
  const runs = sortLatestFirst(state.blogOps.runs, BLOG_RUN_LATEST_FIELDS);
  const latestRun = runs[0] || null;
  const cards = [
    ['Sources', counts.sources ?? '—', isLocalBlogOpsMode() ? 'Local SecOpsAI registry' : status.configured ? 'GitHub backed registry' : 'GitHub token needed'],
    ['Drafts', counts.drafts ?? blogOpsDrafts().length, 'All publication streams'],
    ['Needs review', counts.needs_review ?? 0, 'All streams · editorial state'],
    ['Approved', counts.approved ?? 0, `All streams · ${counts.approved_publishable ?? counts.approved ?? 0} publishable${Number(counts.approved_blocked || 0) ? `, ${counts.approved_blocked} blocked` : ''}`],
    ['Deployed', counts.deployed ?? 0, 'All streams · Cloudflare delivery'],
    ['Latest run', latestRun ? statusLabel(latestRun.status || latestRun.conclusion || 'queued') : '—', latestRun ? fmtDate(latestRun.updated_at) : isLocalBlogOpsMode() ? 'Local helper does not read workflow runs' : 'No workflow run loaded']
  ];
  host.innerHTML = cards.map(([label, value, sub]) => `
    <div class="card metric-card blog-metric-card">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric">${escapeHtml(String(value))}</div>
      <div class="metric-label">${escapeHtml(sub)}</div>
    </div>
  `).join('');
}

function renderBlogDraftList() {
  const host = el('blog-draft-list');
  if (!host) return;
  const drafts = filteredBlogDrafts();
  if (!drafts.length) {
    host.innerHTML = `<div class="empty-state">No drafts match this filter. Run fetch + draft or change the status filter.</div>`;
    return;
  }
  host.innerHTML = `<div class="blog-draft-list">${drafts.map(draft => {
    const selected = String(draft.slug || '') === String(state.blogOps.selectedSlug || '');
    const sources = Array.isArray(draft.sources) ? draft.sources : [];
    return `
      <button class="blog-draft-card ${selected ? 'selected-row' : ''}" data-blog-draft="${escapeHtml(draft.slug || '')}">
        <div class="blog-draft-topline">
          ${renderStatusPill(draft.review_status || 'needs_review')}
          ${renderReadinessPill(draft)}
          <span class="small">${escapeHtml(draft.severity || 'info')}</span>
        </div>
        <h4>${escapeHtml(draft.title || 'Untitled draft')}</h4>
        <p>${escapeHtml(draft.summary || 'No summary available.')}</p>
        <div class="blog-draft-meta">
          <span>${escapeHtml(draft.source_name || 'SecOpsAI')}</span>
          <span>${escapeHtml(fmtDate(draft.updated_at))}</span>
          <span>${sources.length} refs</span>
        </div>
      </button>
    `;
  }).join('')}</div>`;
  host.querySelectorAll('.blog-draft-card').forEach(card => {
    card.addEventListener('click', async () => {
      await loadBlogDraft(card.dataset.blogDraft);
    });
  });
}

function renderBlogDraftPreview() {
  const host = el('blog-draft-preview');
  if (!host) return;
  const draft = state.blogOps.selectedDraft || selectedBlogDraftSummary();
  if (!draft) {
    host.innerHTML = `<div class="empty-state">Select a draft to preview it. External-news drafts are safe text and stay private until approved and published.</div>`;
    return;
  }
  const sources = Array.isArray(draft.sources) ? draft.sources : [];
  const extracted = draft.extracted && typeof draft.extracted === 'object' ? draft.extracted : {};
  const sourceMetadata = draft.source_metadata && typeof draft.source_metadata === 'object' ? draft.source_metadata : {};
  const blockers = Array.isArray(draft.readiness_blockers) ? draft.readiness_blockers : [];
  const warnings = Array.isArray(draft.readiness_warnings) ? draft.readiness_warnings : [];
  const checklist = Array.isArray(draft.review_checklist) ? draft.review_checklist : [];
  const mediaCandidates = Array.isArray(draft.media_candidates) ? draft.media_candidates : [];
  const attachedImages = Array.isArray(draft.images) ? draft.images : [];
  const attachedMediaKeys = new Set();
  attachedImages.forEach(image => {
    [image?.src, image?.source_url, image?.original_src, image?.media_url].forEach(value => {
      const normalized = String(value || '').trim();
      if (normalized) attachedMediaKeys.add(normalized);
    });
  });
  const canAttachSourceMedia = canAttachSourceMediaFromBlogOps();
  const body = draft.body_markdown || 'Click a draft card to load the full generated body.';
  const approved = ['approved', 'reviewed'].includes(String(draft.review_status || ''));
  const ready = !blockers.length && String(draft.readiness_status || '') !== 'blocked';
  const publishHint = approved && ready
    ? 'This draft is approved. Use the Actions card Publish approved to blog button to stage all approved drafts in one protected batch. It stays Approved until Deploy blog to Cloudflare succeeds.'
    : 'Publish approved to blog is a batch action in the Actions card. Approve this draft first; Deploy blog is the separate action that moves staged drafts to Deployed after Cloudflare succeeds.';
  host.innerHTML = `
    <div class="finding-detail-header">
      <div>
        <div class="detail-eyebrow">Blog draft</div>
        <h4>${escapeHtml(draft.title || 'Untitled draft')}</h4>
        <p class="small">${escapeHtml(draft.summary || '')}</p>
      </div>
      <div class="blog-preview-status-stack">
        ${renderStatusPill(draft.review_status || 'needs_review')}
        ${renderReadinessPill(draft)}
      </div>
    </div>
    <div class="kv-list">
      <div class="kv-row"><span class="kv-key">Source</span><span class="kv-val">${escapeHtml(draft.source_name || 'SecOpsAI')}</span></div>
      <div class="kv-row"><span class="kv-key">Severity</span><span class="kv-val">${escapeHtml(draft.severity || 'info')}</span></div>
      <div class="kv-row"><span class="kv-key">Trust</span><span class="kv-val">${escapeHtml(statusLabel(sourceMetadata.source_trust_level || 'unknown'))}</span></div>
      <div class="kv-row"><span class="kv-key">Published</span><span class="kv-val">${escapeHtml(fmtDate(sourceMetadata.published_at))}</span></div>
      <div class="kv-row"><span class="kv-key">Fetched</span><span class="kv-val">${escapeHtml(fmtDate(sourceMetadata.fetched_at))}</span></div>
      <div class="kv-row"><span class="kv-key">Path</span><span class="kv-val">${escapeHtml(draft.path || draft.slug || '')}</span></div>
    </div>
    <h4 style="margin-top:18px;">Readiness blockers</h4>
    ${renderBulletList(blockers, 'No blockers detected. Still review claims before approving.')}
    ${warnings.length ? `<h4 style="margin-top:18px;">Readiness warnings</h4>${renderBulletList(warnings, 'No warnings')}` : ''}
    <h4 style="margin-top:18px;">Extracted intelligence</h4>
    <div class="blog-extracted-grid">
      <div><span class="blog-field-label">CVEs</span>${renderCompactChips(extracted.cves)}</div>
      <div><span class="blog-field-label">Packages</span>${renderCompactChips(extracted.packages)}</div>
      <div><span class="blog-field-label">Products</span>${renderCompactChips(extracted.products)}</div>
      <div><span class="blog-field-label">IOCs</span>${renderCompactChips([...(extracted.urls || []), ...(extracted.domains || []), ...(extracted.ips || []), ...(extracted.hashes || [])])}</div>
    </div>
    ${checklist.length ? `<h4 style="margin-top:18px;">Review checklist</h4><ul class="blog-checklist">${checklist.map(item => `<li><span>${escapeHtml(item.label || '')}</span><em>${escapeHtml(statusLabel(item.status || 'needs_review'))}</em></li>`).join('')}</ul>` : ''}
    <h4 style="margin-top:18px;">References</h4>
    <div class="blog-reference-list">${sources.length ? sources.map(source => `<a href="${escapeHtml(source)}" target="_blank" rel="noreferrer">${escapeHtml(source)}</a>`).join('') : '<span class="small">No references listed.</span>'}</div>
    <h4 style="margin-top:18px;">Images & source screenshots</h4>
    <div class="blog-source-media-panel">
      <div class="small">${escapeHtml(canAttachSourceMedia ? 'Attach a source image candidate or approved source image URL. Attachments reset the draft to Needs review so the image can be checked before publishing.' : 'Source image attachment is available in local helper mode only. Use local Blog Ops to fetch images, or attach a local screenshot with the CLI.')}</div>
      <div class="blog-media-attached">
        ${attachedImages.length ? attachedImages.map(image => `<span class="compact-chip">${escapeHtml(image.kind || 'image')}: ${escapeHtml(image.alt || image.src || '')}</span>`).join('') : '<span class="small">No approved images attached yet.</span>'}
      </div>
      <div class="blog-source-media-candidates">
        ${mediaCandidates.length ? mediaCandidates.slice(0, 6).map((candidate, index) => {
          const src = candidate?.src || candidate?.url || '';
          const candidateKeys = [src, candidate?.url, candidate?.source_url]
            .map(value => String(value || '').trim())
            .filter(Boolean);
          const isAttached = candidateKeys.some(key => attachedMediaKeys.has(key));
          return `<div class="blog-source-media-row">
            <span class="blog-source-media-url">${escapeHtml(src || 'source media candidate')}</span>
            ${isAttached
              ? '<span class="triage-rec-pill actionability-actionable">Attached</span>'
              : `<button class="mini-btn blog-source-media-btn" type="button" data-source-media-index="${escapeHtml(String(index))}" ${canAttachSourceMedia ? '' : 'disabled title="Use local helper mode to attach source media."'}>Attach image</button>`}
          </div>`;
        }).join('') : '<div class="small">No image candidates were provided by this feed. Paste a source image URL below, or take a screenshot and use the CLI attach-media fallback.</div>'}
      </div>
      <div class="blog-source-media-custom">
        <input id="blog-source-media-url" type="url" placeholder="https://source.example/image.png" ${canAttachSourceMedia ? '' : 'disabled'} />
        <input id="blog-source-media-alt" type="text" placeholder="Alt text for the image" ${canAttachSourceMedia ? '' : 'disabled'} />
        <button class="secondary-btn" id="blog-source-media-url-btn" type="button" ${canAttachSourceMedia ? '' : 'disabled title="Use local helper mode to attach source media."'}>Attach source image URL</button>
      </div>
    </div>
    <h4 style="margin-top:18px;">Generated body</h4>
    <pre class="blog-preview-body">${escapeHtml(body)}</pre>
    <label class="blog-review-note"><span class="small">Reviewer note</span><textarea id="blog-review-note" rows="3" placeholder="Why did you approve or reject this draft?"></textarea></label>
    <div class="blog-publish-ready-callout ${approved && ready ? 'ready' : ''}">${escapeHtml(publishHint)}</div>
    <div class="task-card-actions blog-preview-actions">
      <button class="secondary-btn" id="blog-edit-btn">Edit draft</button>
      <button class="mini-btn" id="blog-approve-btn">Approve</button>
      <button class="mini-btn" id="blog-needs-review-btn">Needs review</button>
      <button class="mini-btn" id="blog-reject-btn">Reject</button>
    </div>
  `;
  const noteValue = () => el('blog-review-note')?.value || '';
  el('blog-edit-btn')?.addEventListener('click', () => openBlogEditModal(draft.slug));
  el('blog-approve-btn')?.addEventListener('click', (event) => runBlogOpsAction('approve', { draft: draft.slug, note: noteValue(), button: event.currentTarget }));
  el('blog-needs-review-btn')?.addEventListener('click', (event) => runBlogOpsAction('needs-review', { draft: draft.slug, note: noteValue(), button: event.currentTarget }));
  el('blog-reject-btn')?.addEventListener('click', (event) => runBlogOpsAction('reject', { draft: draft.slug, note: noteValue(), button: event.currentTarget }));
  host.querySelectorAll('.blog-source-media-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      if (!canAttachSourceMediaFromBlogOps()) {
        showToast('Source image attachment is available in local helper mode only.', 'info');
        return;
      }
      const index = Number(button.dataset.sourceMediaIndex || 0) || 0;
      const candidate = mediaCandidates[index] || {};
      runBlogOpsAction('attach-source-media', {
        draft: draft.slug,
        button: event.currentTarget,
        payload: {
          media_url: candidate.src || candidate.url || '',
          media_index: index,
          alt: candidate.alt || `Source image for ${draft.title || 'blog draft'}`,
          source_name: candidate.source_name || draft.source_name || 'External source',
          source_url: candidate.source_url || sourceMetadata.canonical_url || sources[0] || ''
        }
      });
    });
  });
  el('blog-source-media-url-btn')?.addEventListener('click', (event) => {
    if (!canAttachSourceMediaFromBlogOps()) {
      showToast('Source image attachment is available in local helper mode only.', 'info');
      return;
    }
    const mediaUrl = (el('blog-source-media-url')?.value || '').trim();
    if (!mediaUrl) {
      showToast('Paste a source image URL first.', 'info');
      return;
    }
    runBlogOpsAction('attach-source-media', {
      draft: draft.slug,
      button: event.currentTarget,
      payload: {
        media_url: mediaUrl,
        alt: (el('blog-source-media-alt')?.value || '').trim() || `Source image for ${draft.title || 'blog draft'}`,
        source_name: draft.source_name || 'External source',
        source_url: sourceMetadata.canonical_url || sources[0] || mediaUrl
      }
    });
  });
}

function renderBlogWorkflowRuns() {
  const host = el('blog-workflow-runs');
  if (!host) return;
  const runs = sortLatestFirst(state.blogOps.runs, BLOG_RUN_LATEST_FIELDS);
  if (!runs.length) {
    host.innerHTML = `<div class="empty-state">No Blog Ops workflow runs loaded yet.</div>`;
    return;
  }
  host.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Run</th><th>Status</th><th>Branch</th><th>Updated</th><th>Link</th></tr></thead><tbody>${runs.map(run => `
    <tr>
      <td><strong>${escapeHtml(run.name || `Run ${run.id}`)}</strong><div class="small">${escapeHtml(String(run.id || ''))}</div></td>
      <td>${renderStatusPill(run.conclusion || run.status || 'queued')}</td>
      <td>${escapeHtml(run.branch || 'main')}</td>
      <td>${escapeHtml(fmtDate(run.updated_at || run.created_at))}</td>
      <td>${run.html_url ? `<a class="mini-btn" href="${escapeHtml(run.html_url)}" target="_blank" rel="noreferrer">Open</a>` : '<span class="small">—</span>'}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function renderBlogOps() {
  const tokenInput = el('blog-admin-token');
  if (tokenInput && tokenInput.value !== state.blogOps.adminToken) tokenInput.value = state.blogOps.adminToken;
  const status = state.blogOps.status || {};
  const publicationView = state.blogOps.view || 'review';
  const publicationViewCopy = {
    research: ['Original research', 'Prepare and review evidence-led SecOpsAI investigations for publication.'],
    advisories: ['Advisories', 'Publish confirmed defensive guidance, indicators, and mitigations with explicit review.'],
    news: ['News intake', 'Collect and prepare external security news. This content is not original SecOpsAI research.'],
    drafts: ['Drafts', 'Inspect generated editorial drafts and their source references before review.'],
    review: ['Editorial review', 'Approve, reject, or return public content after checking claims, references, disclosure, and safety.'],
    published: ['Published output', 'Review delivery state and deployment history for approved public content.']
  }[publicationView] || ['Editorial review', 'Approve, reject, or return public content after checking claims, references, disclosure, and safety.'];
  const publicationSummary = el('publication-view-summary');
  if (publicationSummary) publicationSummary.innerHTML = `<span class="eyebrow">Publication workspace</span><strong>${escapeHtml(publicationViewCopy[0])}</strong><span>${escapeHtml(publicationViewCopy[1])}</span>`;
  const publicationPage = el('page-blog-ops');
  if (publicationPage) publicationPage.dataset.publicationView = publicationView;
  const contentFilter = el('blog-content-filter');
  if (contentFilter && ['research', 'advisories', 'news'].includes(publicationView) && document.activeElement !== contentFilter) contentFilter.value = publicationView === 'news' ? 'news' : publicationView;
  document.querySelectorAll('#page-blog-ops [data-blog-section]').forEach(section => {
    const allowed = String(section.dataset.blogSection || '').split(/\s+/).filter(Boolean);
    section.hidden = !allowed.includes(publicationView);
  });
  renderBlogOpsStats();
  renderBlogDraftList();
  renderBlogDraftPreview();
  renderBlogWorkflowRuns();
  const authCard = document.querySelector('.blog-auth-card .small');
  if (authCard) {
    authCard.textContent = `${blogOpsAdminTokenHint()}. ${blogOpsWriteActionCopy(status)}`;
  }
  const actionsCopy = el('blog-actions-copy');
  if (actionsCopy) {
    actionsCopy.textContent = blogOpsWriteActionCopy(status);
  }
  const approvedCount = Number(status.counts?.approved ?? 0);
  const publishableApprovedCount = Number(status.counts?.approved_publishable ?? approvedCount);
  const blockedApprovedCount = Number(status.counts?.approved_blocked ?? 0);
  document.querySelectorAll('.blog-action-btn, .blog-source-media-btn, #blog-source-media-url-btn, #blog-approve-btn, #blog-needs-review-btn, #blog-reject-btn, #blog-edit-btn').forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    const action = button.dataset.blogAction || '';
    const draftWriteAction = ['blog-approve-btn', 'blog-needs-review-btn', 'blog-reject-btn'].includes(button.id);
    const mediaWriteAction = button.classList.contains('blog-source-media-btn') || button.id === 'blog-source-media-url-btn';
    if (status.configured === false) {
      button.disabled = true;
      button.title = 'Add BLOG_OPS_GITHUB_TOKEN to Cloudflare Pages before using Blog Ops actions.';
    } else if (mediaWriteAction && !canAttachSourceMediaFromBlogOps()) {
      button.disabled = true;
      button.title = 'Source image attachment is available in local helper mode only.';
    } else if (action === 'deploy' && !canDeployFromBlogOps()) {
      button.disabled = true;
      button.title = 'Deploy is unavailable in this helper mode. Use hosted Blog Ops or the Cloudflare deployment workflow.';
    } else if ((action || draftWriteAction || mediaWriteAction) && !state.blogOps.adminToken) {
      button.disabled = true;
      button.title = 'Paste the Blog Ops admin token and click Use token before running this protected action.';
    } else if (action === 'publish-approved' && approvedCount <= 0) {
      button.disabled = true;
      button.title = 'No approved drafts are ready to publish.';
    } else if (action === 'publish-approved' && publishableApprovedCount <= 0) {
      button.disabled = true;
      button.title = blockedApprovedCount > 0
        ? 'Approved draft(s) are blocked by readiness checks. Open the draft, resolve blockers, or move it back to Needs review.'
        : 'No approved drafts are publishable yet.';
    } else if (
      button.title === 'Add BLOG_OPS_GITHUB_TOKEN to Cloudflare Pages before using Blog Ops actions.' ||
      button.title === 'Source image attachment is available in local helper mode only.' ||
      button.title === 'Deploy is unavailable in this helper mode. Use hosted Blog Ops or the Cloudflare deployment workflow.' ||
      button.title === 'Paste the Blog Ops admin token and click Use token before running this protected action.' ||
      button.title === 'No approved drafts are ready to publish.' ||
      button.title === 'Approved draft(s) are blocked by readiness checks. Open the draft, resolve blockers, or move it back to Needs review.' ||
      button.title === 'No approved drafts are publishable yet.'
    ) {
      button.disabled = false;
      button.title = '';
    }
  });
}

function triageOpsEndpoint(path = '') {
  const base = String(cfg.triageOpsEndpoint || '/api/secopsai/triage-ops').replace(/\/+$/, '');
  return `${base}${path ? `/${path.replace(/^\/+/, '')}` : ''}`;
}

function triageOpsHeaders({ write = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (write && state.triageOps.adminToken) {
    headers['X-Triage-Ops-Admin-Token'] = state.triageOps.adminToken;
  }
  return headers;
}

async function fetchTriageOpsJson(path = '', options = {}) {
  const { write: explicitWrite, ...fetchOptions } = options;
  const isWrite = explicitWrite ?? false;
  const res = await dashboardApiFetch(triageOpsEndpoint(path), {
    ...fetchOptions,
    headers: {
      ...triageOpsHeaders({ write: isWrite }),
      ...(fetchOptions.headers || {})
    }
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    const parts = [payload.error || `Triage Ops HTTP ${res.status}`];
    if (payload.hint) parts.push(payload.hint);
    if (payload.code && !String(parts[0]).includes(payload.code)) parts.push(`code=${payload.code}`);
    throw new Error(parts.filter(Boolean).join(' '));
  }
  return payload;
}

function selectedTriageOpsAlert() {
  const selected = String(state.triageOps.selectedId || '');
  return (state.triageOps.alerts || []).find(alert => String(alert.finding_id || '') === selected) || null;
}

function triageOpsFilters() {
  return {
    status: el('triage-ops-filter-status')?.value || 'all',
    ecosystem: el('triage-ops-filter-ecosystem')?.value || 'all',
    actionability: el('triage-ops-filter-actionability')?.value || 'all',
    severity: el('triage-ops-filter-severity')?.value || 'all',
    search: (el('triage-ops-filter-search')?.value || '').trim().toLowerCase()
  };
}

function filteredTriageOpsAlerts() {
  const filters = triageOpsFilters();
  return sortLatestFirst((state.triageOps.alerts || []).filter(alert => {
    if (filters.status !== 'all' && String(alert.status || '').toLowerCase() !== filters.status) return false;
    if (filters.ecosystem !== 'all' && String(alert.ecosystem || '').toLowerCase() !== filters.ecosystem) return false;
    if (filters.actionability !== 'all' && String(alert.actionability?.bucket || 'actionable') !== filters.actionability) return false;
    if (filters.severity !== 'all' && String(alert.severity || '').toLowerCase() !== filters.severity) return false;
    if (filters.search) {
      const haystack = [
        alert.finding_id,
        alert.package,
        alert.version,
        alert.title,
        alert.summary,
        alert.source
      ].join(' ').toLowerCase();
      const terms = filters.search.split(',').map(t => t.trim()).filter(Boolean);
      if (terms.length > 0) {
        if (!terms.every(term => haystack.includes(term))) return false;
      }
    }
    return true;
  }), FINDING_LATEST_FIELDS);
}

function triageOpsAdminTokenHint() {
  return state.triageOps.adminToken ? 'Token ready for write actions' : 'Paste admin token to enable close/escalate/blog-draft actions';
}

function renderRecommendationPill(recommendation = {}) {
  const disposition = String(recommendation.recommended_disposition || 'needs_review');
  const confidence = String(recommendation.confidence || 'medium');
  return `<span class="triage-rec-pill ${escapeHtml(disposition.replace(/[^a-z0-9_-]/gi, '-').toLowerCase())}">${escapeHtml(statusLabel(disposition))} · ${escapeHtml(confidence)}</span>`;
}

function renderActionabilityPill(actionability = {}) {
  const bucket = String(actionability.bucket || 'actionable');
  const label = String(actionability.label || statusLabel(bucket));
  return `<span class="triage-rec-pill actionability-${escapeHtml(bucket.replace(/[^a-z0-9_-]/gi, '-').toLowerCase())}">${escapeHtml(label)}</span>`;
}

async function loadTriageOpsAlerts({ render = true } = {}) {
  try {
    const payload = await fetchTriageOpsJson('alerts');
    state.triageOps.alerts = sortLatestFirst(payload.alerts || [], FINDING_LATEST_FIELDS);
    const selectedStillVisible = state.triageOps.alerts.some(alert => String(alert.finding_id || '') === String(state.triageOps.selectedId || ''));
    if ((!state.triageOps.selectedId || !selectedStillVisible) && state.triageOps.alerts[0]) {
      state.triageOps.selectedId = state.triageOps.alerts[0].finding_id;
    } else if (!state.triageOps.alerts.length) {
      state.triageOps.selectedId = null;
    }
  } catch (error) {
    state.triageOps.alerts = [];
    state.triageOps.lastOutput = {
      title: 'Triage Ops unavailable',
      error: error.message,
      hint: 'Set SECOPSAI_HELPER_BASE_URL for hosted mode, or run the local dashboard helper.'
    };
  }
  if (render) renderTriageOps();
}

async function runTriageOpsAction(action, { button = null, payload = {}, write = false } = {}) {
  const selectedAlert = selectedTriageOpsAlert();
  if (!selectedAlert && action !== 'refresh-evidence') {
    setStatus('Select a supply-chain alert first.', true);
    return;
  }
  if (write && !state.triageOps.adminToken) {
    const message = 'Paste your Triage Ops admin token, then click Use token before write actions.';
    setStatus(message, true);
    notifyError(message);
    return;
  }
  const body = {
    finding_id: selectedAlert?.finding_id,
    ecosystem: selectedAlert?.ecosystem,
    package: selectedAlert?.package,
    version: selectedAlert?.version,
    ...payload
  };
  setButtonBusy(button, true, 'Running…');
  try {
    const result = await fetchTriageOpsJson(action, {
      write,
      method: 'POST',
      body: JSON.stringify(body)
    });
    state.triageOps.lastOutput = { action, result, at: new Date().toISOString() };
    if (action === 'refresh-evidence' || ['close', 'escalate'].includes(action)) {
      await loadTriageOpsAlerts({ render: false });
      await loadLocalTriageState();
    }
    if (selectedAlert) {
      if (action === 'evidence-verdict' && result) {
        if (result.recommended_note) {
          state.triageOps.verdictNotes[selectedAlert.finding_id] = result.recommended_note;
          const noteBox = el('triage-ops-note');
          if (noteBox) noteBox.value = result.recommended_note;
        }
        if (result.recommended_disposition) {
          const dispSelect = el('triage-ops-disposition');
          if (dispSelect) dispSelect.value = result.recommended_disposition;
        }
        selectedAlert.recommendation = {
          recommended_disposition: result.recommended_disposition || selectedAlert.recommendation?.recommended_disposition,
          confidence: result.confidence || selectedAlert.recommendation?.confidence,
          evidence: [
            ...(result.true_positive_evidence || []),
            ...(result.false_positive_evidence || []),
            ...(result.missing_evidence || [])
          ].map(item => typeof item === 'string' ? item : item.label || item.reason || JSON.stringify(item))
        };
        selectedAlert.severity_score = result.score || selectedAlert.severity_score;
      } else if (action === 'check-advisories' && result?.advisory) {
        selectedAlert.advisory = {
          matched: result.advisory.matched,
          match_count: Array.isArray(result.advisory.matches) ? result.advisory.matches.length : (result.advisory.matched ? 1 : 0)
        };
      } else if (action === 'check-local-usage' && result?.usage) {
        selectedAlert.local_usage = {
          present: result.usage.present,
          match_count: Array.isArray(result.usage.matches) ? result.usage.matches.length : (result.usage.present ? 1 : 0)
        };
      }
    }
    setStatus(`<span class="dot"></span> Triage Ops ${escapeHtml(statusLabel(action))} completed`);
    renderTriageOps();
    await refreshAfterAction({ key: `triage:${action}:${selectedAlert?.finding_id || 'workspace'}` });
  } catch (error) {
    const suffix = /not configured/i.test(error.message) ? ' Configure the local helper/admin token, or use the copyable CLI fallback.' : '';
    state.triageOps.lastOutput = { action, error: `${error.message}${suffix}`, at: new Date().toISOString() };
    setStatus(`Triage Ops ${action} failed: ${error.message}${suffix}`, true);
    renderTriageOps();
  } finally {
    setButtonBusy(button, false);
  }
}

async function runDailyGuideRefresh(button = null) {
  if (bootError) {
    setStatus(bootError, true);
    return;
  }
  setStatus('<span class="dot"></span> Running read-only daily dashboard refresh…');
  await runRefreshAction(button, boot, {
    successMessage: 'Daily dashboard refresh completed',
    errorMessage: 'Daily dashboard refresh failed'
  });
}

async function runTriageOpsEvidenceBundle(button = null) {
  const selectedAlert = selectedTriageOpsAlert();
  if (!selectedAlert) {
    setPage('triage-ops');
    setStatus('Select a supply-chain alert before running the evidence bundle.', true);
    return;
  }
  const actions = ['evidence-verdict', 'investigate', 'explain-verdict', 'check-advisories', 'check-local-usage', 'raw-report'];
  const body = {
    finding_id: selectedAlert.finding_id,
    ecosystem: selectedAlert.ecosystem,
    package: selectedAlert.package,
    version: selectedAlert.version
  };
  const results = {};
  setButtonBusy(button, true, 'Bundling…');
  setStatus(`<span class="dot"></span> Running read-only evidence bundle for ${escapeHtml(selectedAlert.finding_id || selectedAlert.package || 'selected alert')}…`);
  try {
    for (const action of actions) {
      results[action] = await fetchTriageOpsJson(action, {
        method: 'POST',
        body: JSON.stringify(body)
      });
    }
    const verdictResult = results['evidence-verdict'];
    if (verdictResult) {
      selectedAlert.recommendation = {
        recommended_disposition: verdictResult.recommended_disposition || selectedAlert.recommendation?.recommended_disposition,
        confidence: verdictResult.confidence || selectedAlert.recommendation?.confidence,
        evidence: [
          ...(verdictResult.true_positive_evidence || []),
          ...(verdictResult.false_positive_evidence || []),
          ...(verdictResult.missing_evidence || [])
        ].map(item => typeof item === 'string' ? item : item.label || item.reason || JSON.stringify(item))
      };
      selectedAlert.severity_score = verdictResult.score || selectedAlert.severity_score;
      if (verdictResult.recommended_note) {
        state.triageOps.verdictNotes[selectedAlert.finding_id] = verdictResult.recommended_note;
        const noteBox = el('triage-ops-note');
        if (noteBox) noteBox.value = verdictResult.recommended_note;
      }
      const dispSelect = el('triage-ops-disposition');
      if (dispSelect && verdictResult.recommended_disposition) {
        dispSelect.value = verdictResult.recommended_disposition;
      }
    }
    const advisoryResult = results['check-advisories'];
    if (advisoryResult?.advisory) {
      selectedAlert.advisory = {
        matched: advisoryResult.advisory.matched,
        match_count: Array.isArray(advisoryResult.advisory.matches) ? advisoryResult.advisory.matches.length : (advisoryResult.advisory.matched ? 1 : 0)
      };
    }
    const usageResult = results['check-local-usage'];
    if (usageResult?.usage) {
      selectedAlert.local_usage = {
        present: usageResult.usage.present,
        match_count: Array.isArray(usageResult.usage.matches) ? usageResult.usage.matches.length : (usageResult.usage.present ? 1 : 0)
      };
    }
    state.triageOps.lastOutput = {
      action: 'evidence-bundle',
      result: {
        finding_id: selectedAlert.finding_id,
        package: selectedAlert.package,
        version: selectedAlert.version,
        ecosystem: selectedAlert.ecosystem,
        actions,
        results
      },
      at: new Date().toISOString()
    };
    setPage('triage-ops');
    setStatus('<span class="dot"></span> Selected alert evidence bundle completed');
    renderTriageOps();
  } catch (error) {
    const suffix = /not configured/i.test(error.message) ? ' Configure the local helper/admin token, or use the copyable CLI fallback.' : '';
    state.triageOps.lastOutput = { action: 'evidence-bundle', error: `${error.message}${suffix}`, at: new Date().toISOString() };
    setPage('triage-ops');
    setStatus(`Evidence bundle failed: ${error.message}${suffix}`, true);
    renderTriageOps();
  } finally {
    setButtonBusy(button, false);
  }
}

async function runGuideDiscoveryReview(button = null) {
  setPage('triage-ops');
  const dock = document.querySelector('.triage-campaign-dock');
  if (dock) dock.open = true;
  await runCampaignDiscoveryAction('campaign-discover', { button });
}

function campaignArray(name) {
  const values = state.triageOps.campaign?.[name];
  return Array.isArray(values) && values.length ? values : [''];
}

function campaignInputValue(selector) {
  return (document.querySelector(selector)?.value || '').trim();
}

function syncCampaignFormFromDom() {
  const form = state.triageOps.campaign;
  if (!form) return;
  form.campaign_id = campaignInputValue('#campaign-id-input');
  form.title = campaignInputValue('#campaign-title-input');
  form.summary = campaignInputValue('#campaign-summary-input');
  form.search_root = campaignInputValue('#campaign-search-root-input');
  form.jsonText = document.querySelector('#campaign-json-input')?.value || form.jsonText || '';
  ['source_urls', 'source_names', 'actors', 'publishers', 'iocs', 'behavioral_indicators'].forEach(name => {
    form[name] = [...document.querySelectorAll(`[data-campaign-list="${name}"]`)].map(input => input.value.trim());
  });
  form.packages = [...document.querySelectorAll('.campaign-package-row')].map(row => ({
    ecosystem: row.querySelector('[data-campaign-package-field="ecosystem"]')?.value || 'npm',
    package: row.querySelector('[data-campaign-package-field="package"]')?.value.trim() || '',
    version: row.querySelector('[data-campaign-package-field="version"]')?.value.trim() || '',
    publisher: row.querySelector('[data-campaign-package-field="publisher"]')?.value.trim() || '',
    behavior_notes: row.querySelector('[data-campaign-package-field="behavior_notes"]')?.value.trim() || ''
  }));
}

const CAMPAIGN_GENERIC_PACKAGE_WORDS = new Set([
  'overview', 'description', 'impact', 'solution', 'mitigation', 'mitigations', 'separator',
  'byline-author', 'text-align', 'data-original-height', 'data-original-width', 'front-end',
  'attacker-controlled', 'hardware-backed', 'short-lived', 'hardware-bound', 'per-session',
  'cross-site', 'cross-origin', 'sign-on', 'sign-in', 'pre-existing', 'software-based',
  'high-assurance', 'co-located', 'certificate', 'jailbreaks', 'push', 'acknowledgement',
  'acknowledgements', 'acknowledgment', 'acknowledgments', 'open-source', 'out-of-bounds',
  'gpt-generated', 'user-supplied', 'ai-assisted', 'web-based', 'content-serving',
  'unsafe.slice', 'denial-of-service', 'remote-code-execution', 'ltr', 'presentation',
  'font-family', 'sans-serif', 'font-size', 'font-weight', 'font-variant-alternates',
  'font-variant-east-asian', 'font-variant-emoji', 'font-variant-numeric',
  'font-variant-position', 'vertical-align', 'white-space-collapse', 'line-height',
  'margin-bottom', 'margin-top', 'margin-left', 'padding-inline-start',
  'text-decoration-line', 'text-decoration-skip-ink', 'all-time', 'inline-block',
  'aria-level', 'list-style-type', 'white-space', 'text-wrap-mode', 'chrome-friends'
]);

function analyzeCampaignPackageNoise(row = {}) {
  const ecosystem = String(row.ecosystem || 'npm').toLowerCase();
  const name = String(row.package || '').trim().toLowerCase();
  if (!name) {
    return {
      isNoise: false,
      reasons: []
    };
  }
  const reasons = [];
  if (CAMPAIGN_GENERIC_PACKAGE_WORDS.has(name)) reasons.push('generic article/CSS word');
  if (/^docs-internal-guid-[a-f0-9-]{20,}$/i.test(name)) reasons.push('Google Docs editor artifact');
  if (/^\d+(\.\d+)?$/.test(name)) reasons.push('numeric token');
  if (/^cve-\d{4}-\d{4,}\.?$/i.test(name)) reasons.push('CVE identifier, not package id');
  if (/\.(png|jpe?g|gif|webp|svg|html?|css|js)$/i.test(name)) reasons.push('file or page name');
  if (/^(https?:\/\/|www\.)/.test(name)) reasons.push('URL rather than package id');
  if (/^[a-z0-9.-]+\.(com|org|net|io|dev|gov|edu|life|app|co)(\/|$)/i.test(name)) reasons.push('domain rather than package id');
  if (name.length > 90 && !name.includes('/')) reasons.push('long encoded-looking token');
  if (name.length > 55 && name.split('-').length > 6 && !name.startsWith('@')) reasons.push('article slug, not package id');
  if (/(^|\/)(issues|pulls|actions|releases|blob|tree)$/.test(name)) reasons.push('repository page path');
  if (ecosystem === 'npm' && name.includes('/') && !name.startsWith('@') && /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(name)) reasons.push('web path misread as npm package');
  if (ecosystem === 'go' && /\/(issues|pulls|actions|blob|tree)(\/|$)/.test(name)) reasons.push('repository page URL not module root');
  return {
    isNoise: reasons.length > 0,
    reasons
  };
}

function campaignNoiseSummary(packages = []) {
  const rows = Array.isArray(packages) ? packages : [];
  const analyses = rows.map(row => ({ row, analysis: analyzeCampaignPackageNoise(row) }));
  const noise = analyses.filter(item => item.analysis.isNoise);
  const clean = analyses.filter(item => !item.analysis.isNoise);
  return { total: rows.length, clean, noise };
}

function campaignIocValues(campaign = {}) {
  const iocs = campaign.iocs;
  if (Array.isArray(iocs)) return iocs.map(String).filter(Boolean);
  if (iocs && typeof iocs === 'object') return Object.values(iocs).flat().map(String).filter(Boolean);
  return [];
}

function campaignWatchlistSuggestions(campaign = {}, orchestrator = null) {
  const suggestions = [];
  const seen = new Set();
  const add = (kind, value, label = '') => {
    const clean = String(value || '').trim();
    if (!clean) return;
    if (/^(known|unknown|publisher|maintainer|actor)$/i.test(clean)) return;
    const key = `${kind}:${clean.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push({ kind, value: clean, label: label || clean });
  };
  if (campaign.campaign_id) add('ioc', `campaign:${campaign.campaign_id}`, `campaign:${campaign.campaign_id}`);
  const validatedPackages = Array.isArray(orchestrator?.validated_packages) ? orchestrator.validated_packages : (campaign.packages || []);
  const validatedIocs = orchestrator?.validated_iocs && typeof orchestrator.validated_iocs === 'object'
    ? Object.values(orchestrator.validated_iocs).flat().map(String).filter(Boolean)
    : campaignIocValues(campaign);
  (orchestrator?.actors || campaign.actors || []).forEach(actor => add('publisher', actor));
  (orchestrator?.publishers || campaign.publishers || []).forEach(publisher => add('publisher', publisher));
  validatedPackages.forEach(row => {
    if (!analyzeCampaignPackageNoise(row).isNoise && row.package) {
      add('package', `${row.ecosystem || 'npm'}:${row.package}`);
    }
    if (row.publisher) add('publisher', row.publisher);
  });
  validatedIocs.forEach(ioc => {
    const value = String(ioc || '').trim();
    if (!value) return;
    add('ioc', value);
  });
  return suggestions.slice(0, 18);
}

function renderWatchlistSuggestions(campaign = {}, orchestrator = null) {
  const suggestions = campaignWatchlistSuggestions(campaign, orchestrator);
  if (!suggestions.length) return '<div class="empty-state compact">No watchlist suggestions yet. Select or build a campaign with packages, publishers, IOCs, or sources.</div>';
  return `
    <div class="campaign-watchlist-suggestions">
      <div class="small">Watchlist suggestions from reviewed campaign fields</div>
      <div class="campaign-suggestion-list">
        ${suggestions.map(item => `
          <button class="mini-btn campaign-watchlist-suggestion" type="button" data-watchlist-kind="${escapeHtml(item.kind)}" data-watchlist-value="${escapeHtml(item.value)}">
            ${escapeHtml(statusLabel(item.kind))}: ${escapeHtml(item.label)}
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function summarizeTriageActionOutput(output = {}, primary = {}) {
  const action = statusLabel(output.action || 'status');
  const result = output.result || {};
  if (output.action === 'refresh-evidence') {
    const summary = result.summary || {};
    const intel = result.intel || {};
    return [
      `Refresh evidence completed`,
      `${summary.open_findings ?? '—'} open finding(s)`,
      `${summary.in_review_findings ?? '—'} in review`,
      `${summary.pending_actions ?? '—'} pending action(s)`,
      intel.stdout ? String(intel.stdout).trim() : ''
    ].filter(Boolean);
  }
  if (primary && typeof primary === 'object' && !Array.isArray(primary)) {
    const keys = Object.keys(primary).slice(0, 5);
    return [`${action} completed`, keys.length ? `Returned: ${keys.join(', ')}` : 'No structured fields returned'];
  }
  return [`${action} completed`];
}

function renderRawActionDetails(primary = {}) {
  const raw = JSON.stringify(primary, null, 2);
  if (!raw || raw === '{}') return '';
  return `
    <details class="triage-raw-drawer">
      <summary>Show raw helper output</summary>
      <pre>${escapeHtml(raw.slice(0, 12000))}</pre>
    </details>
  `;
}

function cleanCampaignPackageNoiseFromState() {
  const form = state.triageOps.campaign || defaultCampaignForm();
  const summary = campaignNoiseSummary(form.packages || []);
  const cleaned = summary.clean.map(item => item.row).filter(row => String(row.package || '').trim());
  form.packages = cleaned.length ? cleaned : defaultCampaignForm().packages;
  form.jsonText = JSON.stringify({
    campaign_id: form.campaign_id || '',
    title: form.title || '',
    summary: form.summary || '',
    source_urls: (form.source_urls || []).filter(Boolean),
    source_names: (form.source_names || []).filter(Boolean),
    actors: (form.actors || []).filter(Boolean),
    publishers: (form.publishers || []).filter(Boolean),
    iocs: { operator_supplied: (form.iocs || []).filter(Boolean) },
    behavioral_indicators: (form.behavioral_indicators || []).filter(Boolean),
    packages: form.packages
  }, null, 2);
  state.triageOps.campaign = form;
  return summary;
}

function cleanCampaignPackageNoise({ render = true } = {}) {
  syncCampaignFormFromDom();
  const summary = cleanCampaignPackageNoiseFromState();
  setStatus(`<span class="dot"></span> Removed ${summary.noise.length} obvious noisy package extraction${summary.noise.length === 1 ? '' : 's'}`);
  if (render) renderTriageOps();
}

function campaignFormToPayload() {
  syncCampaignFormFromDom();
  const form = state.triageOps.campaign || defaultCampaignForm();
  const cleanList = (items = []) => items.map(item => String(item || '').trim()).filter(Boolean);
  return {
    campaign_id: form.campaign_id.trim(),
    title: form.title.trim(),
    summary: form.summary.trim(),
    source_urls: cleanList(form.source_urls),
    source_names: cleanList(form.source_names),
    actors: cleanList(form.actors),
    publishers: cleanList(form.publishers),
    iocs: { operator_supplied: cleanList(form.iocs) },
    behavioral_indicators: cleanList(form.behavioral_indicators),
    packages: (form.packages || []).map(row => ({
      ecosystem: row.ecosystem || 'npm',
      package: String(row.package || '').trim(),
      version: String(row.version || '').trim(),
      publisher: String(row.publisher || '').trim(),
      behavioral_indicators: cleanList(String(row.behavior_notes || '').split(/\n|,/))
    })).filter(row => row.package)
  };
}

function sanitizeCampaignSummary(summary = '') {
  return String(summary || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 700);
}

function setCampaignFormFromPayload(payload = {}) {
  resetResearchCaseRecommendation();
  const iocs = payload.iocs && typeof payload.iocs === 'object'
    ? Object.values(payload.iocs).flat().map(String)
    : [];
  state.triageOps.campaign = {
    ...defaultCampaignForm(),
    campaign_id: payload.campaign_id || '',
    title: payload.title || '',
    summary: sanitizeCampaignSummary(payload.summary || ''),
    source_urls: Array.isArray(payload.source_urls) && payload.source_urls.length ? payload.source_urls : [''],
    source_names: Array.isArray(payload.source_names) && payload.source_names.length ? payload.source_names : [''],
    actors: Array.isArray(payload.actors) && payload.actors.length ? payload.actors : [''],
    publishers: Array.isArray(payload.publishers) && payload.publishers.length ? payload.publishers : [''],
    iocs: iocs.length ? iocs : [''],
    behavioral_indicators: Array.isArray(payload.behavioral_indicators) && payload.behavioral_indicators.length ? payload.behavioral_indicators : [''],
    packages: Array.isArray(payload.packages) && payload.packages.length
      ? payload.packages.map(row => ({
          ecosystem: row.ecosystem || 'npm',
          package: row.package || '',
          version: row.version || row.revision || '',
          publisher: row.publisher || row.maintainer || '',
          behavior_notes: Array.isArray(row.behavioral_indicators) ? row.behavioral_indicators.join('\n') : ''
        }))
      : defaultCampaignForm().packages,
    jsonText: JSON.stringify(payload, null, 2),
    jsonError: ''
  };
}

async function loadCampaignFixtures({ render = false } = {}) {
  try {
    const payload = await fetchTriageOpsJson('campaign-fixtures');
    state.triageOps.campaignFixtures = Array.isArray(payload.fixtures) ? payload.fixtures : [];
  } catch (error) {
    state.triageOps.campaignFixtures = [];
    state.triageOps.campaignLastOutput = {
      action: 'campaign-fixtures',
      error: `${error.message}. Campaign fixtures are optional; paste campaign JSON or build one manually.`
    };
  }
  if (render) renderTriageOps();
}

function campaignCliFallback() {
  const payload = campaignFormToPayload();
  const packages = (payload.packages || [])
    .map(row => `--package ${row.ecosystem}:${row.package}:${row.version || '<version>'}`)
    .join(' ');
  return [
    'cd /Users/chrixchange/secopsai',
    `python3 -m secopsai.cli supply-chain research-campaign --campaign-id ${payload.campaign_id || '<campaign-id>'} ${packages} --dry-run --json`,
    'python3 -m secopsai.cli supply-chain research-campaign --input campaign.json --persist --search-root /Users/chrixchange/secopsai',
    'python3 -m secopsai.cli blog draft-campaign --campaign campaign.json'
  ].join('\n');
}

async function runCampaignEndpoint(action, { button = null, write = false, confirmMessage = '' } = {}) {
  if (write && !state.triageOps.adminToken) {
    const message = 'Paste your Triage Ops admin token, then click Use token before campaign write actions.';
    setStatus(message, true);
    notifyError(message);
    return;
  }
  if (confirmMessage && !(await requestConfirmation(confirmMessage, { title: 'Review campaign action', confirmLabel: write ? 'Authorize action' : 'Run analysis' }))) return;
  let campaign;
  try {
    campaign = campaignFormToPayload();
    if (!campaign.packages.length) throw new Error('Add at least one package before running campaign research.');
  } catch (error) {
    state.triageOps.campaign.jsonError = error.message;
    renderTriageOps();
    return;
  }
  const searchRoot = campaignInputValue('#campaign-search-root-input');
  setButtonBusy(button, true, 'Running…');
  try {
    const result = await fetchTriageOpsJson(action, {
      write,
      method: 'POST',
      body: JSON.stringify({ campaign, search_root: searchRoot })
    });
    state.triageOps.campaignResult = result.result || result;
    state.triageOps.campaignLastOutput = { action, result, at: new Date().toISOString() };
    resetResearchCaseRecommendation();
    if (action === 'campaign-persist-findings') {
      await loadTriageOpsAlerts({ render: false });
      await loadLocalTriageState();
    }
    if (action === 'campaign-blog-draft') {
      await loadBlogOpsStatus({ render: false });
    }
    setStatus(`<span class="dot"></span> Campaign ${escapeHtml(statusLabel(action))} completed`);
    renderTriageOps();
  } catch (error) {
    const message = campaignActionErrorMessage(action, error);
    state.triageOps.campaignLastOutput = { action, error: message, at: new Date().toISOString() };
    setStatus(`Campaign ${action} failed: ${message}`, true);
    renderTriageOps();
  } finally {
    setButtonBusy(button, false);
  }
}

function syncCampaignDiscoveryFromDom() {
  const discovery = state.triageOps.campaignDiscovery || {};
  discovery.since = campaignInputValue('#campaign-discovery-since') || discovery.since || '24h';
  discovery.source = campaignInputValue('#campaign-discovery-source') || discovery.source || 'all';
  discovery.limit = Number(campaignInputValue('#campaign-discovery-limit') || discovery.limit || 10);
  discovery.min_score = Number(campaignInputValue('#campaign-discovery-min-score') || discovery.min_score || 35);
  discovery.watchlistKind = el('campaign-watchlist-kind')?.value || discovery.watchlistKind || 'package';
  discovery.watchlistValue = campaignInputValue('#campaign-watchlist-value');
  state.triageOps.campaignDiscovery = discovery;
}

function discoveryPayload({ persist = false, createDrafts = false } = {}) {
  syncCampaignDiscoveryFromDom();
  const discovery = state.triageOps.campaignDiscovery || {};
  return {
    since: discovery.since || '24h',
    source: discovery.source || 'all',
    limit: Math.max(1, Math.min(Number(discovery.limit || 10), 50)),
    min_score: Math.max(0, Math.min(Number(discovery.min_score || 35), 100)),
    search_root: campaignInputValue('#campaign-search-root-input'),
    persist,
    create_drafts: createDrafts
  };
}

function selectedCampaignCandidate() {
  const id = state.triageOps.campaignDiscovery?.selectedCandidateId || '';
  return campaignCandidates().find(candidate => String(candidate.candidate_id || '') === id) || null;
}

function campaignCandidates() {
  return sortLatestFirst(state.triageOps.campaignCandidates, CAMPAIGN_CANDIDATE_LATEST_FIELDS);
}

function campaignDiscoveryCliFallback() {
  const payload = discoveryPayload();
  return [
    'cd /Users/chrixchange/secopsai',
    `python3 -m secopsai.cli supply-chain discover-campaigns --since ${payload.since} --source ${payload.source || 'all'} --limit ${payload.limit} --orchestrate --json`,
    `python3 -m secopsai.cli supply-chain campaign-autopilot --since ${payload.since} --limit ${payload.limit} --min-score ${payload.min_score} --dry-run --orchestrate --json`,
    'python3 -m secopsai.cli supply-chain orchestrate-candidate --input candidate.json --json',
    'python3 -m secopsai.cli supply-chain campaign-watchlist add --package npm:package-name',
    'python3 -m secopsai.cli supply-chain campaign-candidates list --json',
    'python3 -m secopsai.cli supply-chain campaign-candidates promote <candidate-id> --json'
  ].join('\n');
}

function campaignActionErrorMessage(action, error) {
  const raw = error?.message || String(error || 'Campaign action failed');
  if (/Finding not found or not active/i.test(raw)) {
    return `${raw} This campaign action reached an older helper route that only understands single-finding actions. Restart or update the local SecOpsAI dashboard helper, then refresh Triage Ops and retry ${statusLabel(action)}.`;
  }
  if (/not configured/i.test(raw)) {
    return `${raw} Hosted helper-backed actions are intentionally not configured unless SECOPSAI_HELPER_BASE_URL points to a live private helper. Use local helper mode at http://127.0.0.1:45680 for Triage Ops actions.`;
  }
  return raw;
}

async function runCampaignDiscoveryAction(action, { button = null, write = false, confirmMessage = '', body = null } = {}) {
  if (write && !state.triageOps.adminToken) {
    const message = 'Paste your Triage Ops admin token, then click Use token before campaign discovery write actions.';
    setStatus(message, true);
    notifyError(message);
    return;
  }
  if (confirmMessage && !(await requestConfirmation(confirmMessage, { title: 'Review discovery action', confirmLabel: write ? 'Authorize action' : 'Run discovery' }))) return;
  setButtonBusy(button, true, 'Running…');
  try {
    const payload = body || discoveryPayload();
    const result = await fetchTriageOpsJson(action, {
      write,
      method: 'POST',
      body: JSON.stringify(payload)
    });
    state.triageOps.campaignLastOutput = { action, result, at: new Date().toISOString() };
    if (Array.isArray(result.candidates)) {
      state.triageOps.campaignCandidates = sortLatestFirst(result.candidates, CAMPAIGN_CANDIDATE_LATEST_FIELDS);
      const selectedStillVisible = state.triageOps.campaignCandidates.some(candidate => String(candidate.candidate_id || '') === String(state.triageOps.campaignDiscovery.selectedCandidateId || ''));
      if ((!state.triageOps.campaignDiscovery.selectedCandidateId || !selectedStillVisible) && state.triageOps.campaignCandidates[0]) {
        state.triageOps.campaignDiscovery.selectedCandidateId = state.triageOps.campaignCandidates[0].candidate_id || '';
      } else if (!state.triageOps.campaignCandidates.length) {
        state.triageOps.campaignDiscovery.selectedCandidateId = '';
      }
    }
    if (action === 'campaign-orchestrate' && result.candidate) {
      const reviewed = result.candidate;
      const reviewedId = reviewed.candidate_id || selectedCampaignCandidate()?.candidate_id || '';
      const candidates = [...(state.triageOps.campaignCandidates || [])];
      const index = candidates.findIndex(candidate => String(candidate.candidate_id || '') === String(reviewedId));
      if (index >= 0) {
        candidates[index] = { ...candidates[index], ...reviewed, candidate_id: reviewedId };
      } else {
        candidates.unshift({ ...reviewed, candidate_id: reviewedId });
      }
      state.triageOps.campaignCandidates = sortLatestFirst(candidates, CAMPAIGN_CANDIDATE_LATEST_FIELDS);
      state.triageOps.campaignDiscovery.selectedCandidateId = reviewedId;
    }
    if (result.campaign) {
      setCampaignFormFromPayload(result.campaign);
      if (action === 'campaign-promote') {
        const summary = cleanCampaignPackageNoiseFromState();
        state.triageOps.campaignLastOutput = {
          action,
          result,
          review: {
            removed_noisy_packages: summary.noise.length,
            retained_packages: summary.clean.length
          },
          at: new Date().toISOString()
        };
      }
    }
    if (action === 'campaign-autopilot') {
      state.triageOps.campaignResult = result.result || result;
      if (payload.persist) {
        await loadTriageOpsAlerts({ render: false });
        await loadLocalTriageState();
      }
    }
    if (action === 'campaign-blog-draft' || payload.create_drafts) {
      await loadBlogOpsStatus({ render: false });
    }
    setStatus(`<span class="dot"></span> Campaign discovery ${escapeHtml(statusLabel(action))} completed`);
    renderTriageOps();
    await refreshAfterAction({ key: `campaign:${action}` });
  } catch (error) {
    const message = campaignActionErrorMessage(action, error);
    state.triageOps.campaignLastOutput = { action, error: message, at: new Date().toISOString() };
    setStatus(`Campaign discovery ${action} failed: ${message}`, true);
    renderTriageOps();
  } finally {
    setButtonBusy(button, false);
  }
}

function renderCampaignCandidateList() {
  const candidates = campaignCandidates();
  if (!candidates.length) {
    return '<div class="empty-state">No discovery candidates loaded yet. Run Discovery to fill the inbox, or load saved candidates if a previous run already found leads.</div>';
  }
  return `
    <div class="campaign-candidate-list">
      ${candidates.slice(0, 20).map(candidate => {
        const campaign = candidate.campaign || {};
        const orchestrator = candidate.orchestrator || {};
        const route = orchestrator.recommended_route || 'needs_human_review';
        const routeBlocked = Array.isArray(orchestrator.route_blockers) && orchestrator.route_blockers.length;
        const packagesForReview = Array.isArray(orchestrator.validated_packages) ? orchestrator.validated_packages : (campaign.packages || []);
        const review = campaignNoiseSummary(packagesForReview);
        const packageArtifacts = review.clean.filter(item => String(item.row.ecosystem || '') !== 'github');
        const repos = Array.isArray(orchestrator.github_repos) ? orchestrator.github_repos : review.clean.filter(item => String(item.row.ecosystem || '') === 'github').map(item => item.row.package);
        const packages = packageArtifacts.slice(0, 4).map(item => `${item.row.ecosystem}:${item.row.package}@${item.row.version || 'unknown'}`).join(', ');
        const repoText = repos.slice(0, 3).join(', ');
        const noise = review.noise.slice(0, 3).map(item => `${item.row.package} (${item.analysis.reasons[0]})`).join(', ');
        const selected = String(candidate.candidate_id || '') === String(state.triageOps.campaignDiscovery?.selectedCandidateId || '');
        return `
          <button class="campaign-candidate-card ${selected ? 'selected' : ''}" data-campaign-candidate-id="${escapeHtml(candidate.candidate_id || '')}" type="button">
            <span class="triage-row-top"><strong>${escapeHtml(campaign.title || candidate.candidate_id || 'Discovery lead')}</strong><span class="triage-rec-pill ${routeBlocked ? 'needs_review' : 'expected_behavior'}">${escapeHtml(statusLabel(route))}</span></span>
            <span class="small">${escapeHtml(packages || repoText || 'No validated package artifacts')}</span>
            <span class="campaign-noise-summary">${escapeHtml(`${packageArtifacts.length} package artifact(s), ${repos.length} repo/project reference(s), ${review.noise.length} rejected noise item(s)`)}</span>
            ${noise ? `<span class="small">Noise examples: ${escapeHtml(noise)}</span>` : ''}
            <span class="small">${escapeHtml((candidate.score_reasons || []).slice(0, 3).join(', ') || 'No score reasons returned')}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderOrchestratorReview(candidate = null) {
  if (!candidate) {
    return '<div class="empty-state compact">Select a discovery candidate to see the Orchestrator Review before promotion.</div>';
  }
  const review = candidate.orchestrator || {};
  const blockers = Array.isArray(review.route_blockers) ? review.route_blockers : [];
  const validatedPackages = Array.isArray(review.validated_packages) ? review.validated_packages : [];
  const packageArtifacts = validatedPackages.filter(row => String(row.ecosystem || '') !== 'github');
  const githubRepos = Array.isArray(review.github_repos) ? review.github_repos : validatedPackages.filter(row => String(row.ecosystem || '') === 'github').map(row => row.package);
  const rejectedPackages = Array.isArray(review.rejected_package_candidates) ? review.rejected_package_candidates : [];
  const validatedIocs = review.validated_iocs && typeof review.validated_iocs === 'object'
    ? Object.values(review.validated_iocs).flat().map(String).filter(Boolean)
    : [];
  const rejectedIocs = Array.isArray(review.rejected_iocs) ? review.rejected_iocs : [];
  const blockedActions = review.blocked_actions && typeof review.blocked_actions === 'object' ? Object.entries(review.blocked_actions) : [];
  return `
    <div class="campaign-orchestrator-review">
      <div class="triage-row-top">
        <strong>Orchestrator Review</strong>
        <span class="triage-rec-pill ${blockers.length ? 'needs_review' : 'expected_behavior'}">${escapeHtml(statusLabel(review.recommended_route || 'needs_human_review'))}</span>
      </div>
      <p class="small">${escapeHtml(review.explanation || 'Deterministic review classifies, cleans, and routes the candidate before campaign promotion.')}</p>
      <div class="campaign-result-columns">
        <div class="campaign-result-section"><h4>Candidate type</h4><p class="small">${escapeHtml(statusLabel(review.campaign_type || 'unknown'))}</p></div>
        <div class="campaign-result-section"><h4>Supply-chain relevance</h4><p class="small">${escapeHtml(review.supply_chain_relevance || 'unknown')}</p></div>
        <div class="campaign-result-section"><h4>Confidence</h4><p class="small">${escapeHtml(review.confidence || 'unknown')}</p></div>
        <div class="campaign-result-section"><h4>Next action</h4><p class="small">${escapeHtml(review.recommended_next_action || 'Review candidate evidence before taking write actions.')}</p></div>
      </div>
      ${blockers.length ? `<div class="evidence-notice warning"><strong>Blocked:</strong> ${escapeHtml(humanizeMachineText(blockers.join('; ')))}</div>` : ''}
      <div class="campaign-result-columns">
        <div class="campaign-result-section"><h4>Package artifacts</h4>${renderCompactChips(packageArtifacts.map(row => `${row.ecosystem}:${row.package}@${row.version || 'unknown'}`), 'No package artifacts validated.')}</div>
        <div class="campaign-result-section"><h4>Projects / repos</h4>${renderCompactChips(githubRepos.map(repo => `github:${repo}`), 'No project repositories identified.')}</div>
        <div class="campaign-result-section"><h4>Rejected package noise</h4>${renderBulletList(rejectedPackages.slice(0, 8).map(row => `${row.ecosystem || 'unknown'}:${row.package || '(empty)'} — ${row.reason || 'rejected'}`), 'No rejected package candidates.')}</div>
        <div class="campaign-result-section"><h4>Validated IOCs</h4>${renderCompactChips(validatedIocs, 'No attacker IOCs validated.')}</div>
      </div>
      <div class="campaign-result-columns">
        <div class="campaign-result-section"><h4>Rejected IOCs</h4>${renderBulletList(rejectedIocs.slice(0, 8).map(row => `${row.value || ''} — ${row.reason || 'rejected'}`), 'No rejected IOCs.')}</div>
        <div class="campaign-result-section"><h4>Source references</h4>${renderBulletList(review.source_references || [], 'No source references returned.')}</div>
        <div class="campaign-result-section"><h4>Missing evidence</h4>${renderBulletList(review.missing_evidence || [], 'No missing evidence called out.')}</div>
        <div class="campaign-result-section"><h4>Allowed actions</h4>${renderBulletList(review.allowed_actions || [], 'No actions allowed.')}</div>
        <div class="campaign-result-section"><h4>Blocked actions</h4>${renderBulletList(blockedActions.map(([action, reason]) => `${statusLabel(action)}: ${reason}`), 'No actions blocked.')}</div>
      </div>
    </div>
  `;
}

function renderAutonomousDiscoveryPanel() {
  const discovery = state.triageOps.campaignDiscovery || {};
  const selected = selectedCampaignCandidate();
  const suggestionCampaign = selected?.campaign || state.triageOps.campaign || {};
  const selectedReview = selected?.orchestrator || {};
  const selectedBlockers = Array.isArray(selectedReview.route_blockers) ? selectedReview.route_blockers : [];
  const canPromote = selected && selectedReview.recommended_route === 'campaign_research' && !selectedBlockers.length;
  return `
    <div class="campaign-discovery-box">
      <div class="page-header compact-header">
        <div>
          <h4 style="margin:0;">Autonomous Discovery</h4>
          <p class="small" style="margin:6px 0 0;">Discovery is an inbox. It classifies leads, separates source references from attacker IOCs, and routes only validated package/extension campaigns into Campaign Research.</p>
        </div>
      </div>
      <div class="campaign-form-grid">
        <label><span class="small">Since</span><input id="campaign-discovery-since" value="${escapeHtml(discovery.since || '24h')}" placeholder="24h" /></label>
        <label><span class="small">Source</span><input id="campaign-discovery-source" value="${escapeHtml(discovery.source || 'all')}" placeholder="all, Socket, CISA" /></label>
        <label><span class="small">Limit</span><input id="campaign-discovery-limit" value="${escapeHtml(String(discovery.limit || 10))}" type="number" min="1" max="50" /></label>
        <label><span class="small">Min score</span><input id="campaign-discovery-min-score" value="${escapeHtml(String(discovery.min_score || 35))}" type="number" min="0" max="100" /></label>
      </div>
      <div class="campaign-actions">
        <button class="primary-btn" id="campaign-discover-btn" type="button">Run Discovery</button>
        <button class="secondary-btn" id="campaign-autopilot-dry-run-btn" type="button">Run Autopilot Dry Run</button>
        <button class="secondary-btn" id="campaign-review-candidates-btn" type="button">Load Saved Candidates</button>
        <button class="secondary-btn" id="campaign-orchestrate-btn" type="button" ${selected ? '' : 'disabled'} title="${selected ? '' : 'Select a candidate before reviewing route and evidence.'}">Review Selected Lead</button>
        <button class="secondary-btn" id="campaign-promote-btn" type="button" ${canPromote ? '' : 'disabled'} title="${canPromote ? '' : 'Only package/extension campaigns with no route blockers can move into Campaign Research.'}">Use in Campaign Research</button>
        <button class="mini-btn" id="campaign-discovery-copy-cli-btn" type="button">Copy CLI Fallback</button>
      </div>
      <p class="small campaign-action-hint">Discovery does not persist findings or create blog drafts. Use Campaign Research write actions only after a candidate has been routed, promoted, researched, and reviewed.</p>
      <div class="campaign-watchlist-row">
        <select id="campaign-watchlist-kind">
          <option value="package" ${discovery.watchlistKind === 'package' ? 'selected' : ''}>Package</option>
          <option value="publisher" ${discovery.watchlistKind === 'publisher' ? 'selected' : ''}>Publisher</option>
          <option value="ioc" ${discovery.watchlistKind === 'ioc' ? 'selected' : ''}>IOC</option>
          <option value="source_url" ${discovery.watchlistKind === 'source_url' ? 'selected' : ''}>Source URL</option>
        </select>
        <input id="campaign-watchlist-value" value="${escapeHtml(discovery.watchlistValue || '')}" placeholder="npm:node-ipc, deadcode09284814, c2.example" />
        <button class="secondary-btn" id="campaign-watchlist-add-btn" type="button">Add to Watchlist</button>
      </div>
      ${renderOrchestratorReview(selected)}
      <details class="campaign-review-drawer">
        <summary>Watchlist suggestions from validated evidence</summary>
        ${renderWatchlistSuggestions(suggestionCampaign, selectedReview)}
      </details>
      ${renderCampaignCandidateList()}
    </div>
  `;
}

function renderCampaignListInputs(name, label, placeholder) {
  return `
    <div class="campaign-list-field">
      <div class="campaign-list-head">
        <span class="small">${escapeHtml(label)}</span>
        <button class="mini-btn campaign-add-list-btn" type="button" data-campaign-add-list="${escapeHtml(name)}">Add ${escapeHtml(label.replace(/s$/i, ''))}</button>
      </div>
      ${campaignArray(name).map((value, index) => `
        <div class="campaign-inline-row">
          <input data-campaign-list="${escapeHtml(name)}" data-campaign-list-index="${index}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" />
          <button class="mini-btn campaign-remove-list-btn" type="button" data-campaign-remove-list="${escapeHtml(name)}" data-campaign-remove-index="${index}">Remove</button>
        </div>
      `).join('')}
    </div>
  `;
}

function renderCampaignPackageRows() {
  const rows = state.triageOps.campaign.packages?.length ? state.triageOps.campaign.packages : defaultCampaignForm().packages;
  const options = TRIAGE_CAMPAIGN_ECOSYSTEMS.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('');
  return rows.map((row, index) => {
    const noise = analyzeCampaignPackageNoise(row);
    return `
    <div class="campaign-package-row ${noise.isNoise ? 'campaign-package-noise' : ''}" data-campaign-package-index="${index}">
      <label><span class="small">Ecosystem</span><select data-campaign-package-field="ecosystem">${options}</select></label>
      <label><span class="small">Package/artifact id</span><input data-campaign-package-field="package" value="${escapeHtml(row.package || '')}" placeholder="@scope/pkg, group:artifact, org/model" /></label>
      <label><span class="small">Version/revision</span><input data-campaign-package-field="version" value="${escapeHtml(row.version || '')}" placeholder="1.2.3, v1.2.3, revision" /></label>
      <label><span class="small">Publisher/maintainer</span><input data-campaign-package-field="publisher" value="${escapeHtml(row.publisher || '')}" placeholder="namespace or owner" /></label>
      <label class="campaign-package-notes"><span class="small">Behavior notes</span><textarea data-campaign-package-field="behavior_notes" rows="2" placeholder="credential theft, C2, persistence">${escapeHtml(row.behavior_notes || '')}</textarea></label>
      ${noise.isNoise ? `<div class="campaign-noise-note">Likely extraction noise: ${escapeHtml(noise.reasons.join(', '))}</div>` : ''}
      <button class="mini-btn campaign-remove-package-btn" type="button" data-campaign-remove-package="${index}">Remove</button>
    </div>
  `;
  }).join('');
}

function campaignEvidencePreview(row = {}) {
  const values = Array.isArray(row.matched_rules)
    ? row.matched_rules
    : Array.isArray(row.behavioral_indicators)
      ? row.behavioral_indicators
      : [];
  return values.slice(0, 4).join(', ');
}

function renderCampaignResult(result = {}) {
  if (!result || !Object.keys(result).length) {
    const output = state.triageOps.campaignLastOutput;
    if (output?.error) return `<div class="triage-output error"><strong>Campaign action failed</strong><p>${escapeHtml(output.error)}</p></div>`;
    return `<div class="empty-state">Run campaign research to see verdicts, correlations, IOCs, mitigation, and source references here.</div>`;
  }
  const packages = Array.isArray(result.packages) ? result.packages : [];
  const references = Array.isArray(result.references) ? result.references : (Array.isArray(result.source_urls) ? result.source_urls : []);
  const correlations = Array.isArray(result.correlations) ? result.correlations : [];
  const mitigation = Array.isArray(result.recommended_mitigation) ? result.recommended_mitigation : (Array.isArray(result.mitigation) ? result.mitigation : []);
  const iocs = result.iocs && typeof result.iocs === 'object' ? Object.values(result.iocs).flat().map(String) : [];
  return `
    <div class="campaign-result">
      <div class="evidence-score-grid campaign-result-grid">
        <div class="evidence-score-card"><span>Campaign verdict</span><strong>${escapeHtml(statusLabel(result.campaign_verdict || result.package_verdict || 'needs_review'))}</strong></div>
        <div class="evidence-score-card"><span>Confidence</span><strong>${escapeHtml(result.confidence || 'unknown')}</strong></div>
        <div class="evidence-score-card"><span>Score</span><strong>${escapeHtml(String(result.score ?? '—'))}</strong></div>
        <div class="evidence-score-card"><span>Environment impact</span><strong>${escapeHtml(statusLabel(result.environment_impact?.status || result.environment_impact || 'unknown'))}</strong></div>
      </div>
      ${result.blog_ready_summary ? `<div class="evidence-notice">${escapeHtml(result.blog_ready_summary)}</div>` : ''}
      <div class="campaign-result-section">
        <h4>Package verdicts</h4>
        ${packages.length ? `
          <div class="campaign-table-wrap"><table class="campaign-table"><thead><tr><th>Ecosystem</th><th>Package</th><th>Version</th><th>Verdict</th><th>Evidence</th></tr></thead><tbody>
            ${packages.slice(0, 20).map(row => `
              <tr>
                <td>${escapeHtml(row.ecosystem || '')}</td>
                <td>${escapeHtml(row.package || '')}</td>
                <td>${escapeHtml(row.version || '')}</td>
                <td>${escapeHtml(statusLabel(row.package_verdict || row.verdict || result.package_verdict || 'needs_review'))}</td>
                <td>${escapeHtml(campaignEvidencePreview(row))}</td>
              </tr>
            `).join('')}
          </tbody></table></div>
        ` : '<p class="small">No package verdicts returned. If this lead is a CVE, malware/APT story, GitHub breach, or general news item, keep it in the routed review lane instead of forcing Campaign Research.</p>'}
      </div>
      <div class="campaign-result-columns">
        <div class="campaign-result-section"><h4>IOCs</h4>${renderCompactChips(iocs, 'No IOCs returned.')}</div>
        <div class="campaign-result-section"><h4>Correlations</h4>${renderBulletList(correlations.map(item => typeof item === 'string' ? item : item.label || item.reason || JSON.stringify(item)), 'No correlations returned.')}</div>
        <div class="campaign-result-section"><h4>Mitigation</h4>${renderBulletList(mitigation, 'No mitigation returned.')}</div>
        <div class="campaign-result-section"><h4>References</h4>${renderBulletList(references, 'No references returned.')}</div>
      </div>
    </div>
  `;
}

function resetResearchCaseRecommendation({ keepDismissed = false } = {}) {
  state.triageOps.researchRecommendation = {
    data: null,
    dismissed: keepDismissed,
    loading: false,
    error: null,
    stale: false
  };
}

function researchRecommendationPayload() {
  const selected = selectedCampaignCandidate();
  const selectedAlert = selectedTriageOpsAlert();
  return {
    campaign: campaignFormToPayload(),
    candidate_campaign: selected?.campaign || {},
    orchestrator: selected?.orchestrator || {},
    campaign_result: state.triageOps.campaignResult || {},
    candidate_id: selected?.candidate_id || '',
    finding_id: selectedAlert?.finding_id || ''
  };
}

function researchRecommendationHasInput() {
  const payload = researchRecommendationPayload();
  const campaignPackages = Array.isArray(payload.campaign?.packages) ? payload.campaign.packages : [];
  const candidatePackages = Array.isArray(payload.candidate_campaign?.packages) ? payload.candidate_campaign.packages : [];
  const validatedPackages = Array.isArray(payload.orchestrator?.validated_packages) ? payload.orchestrator.validated_packages : [];
  return Boolean(payload.candidate_id || campaignPackages.length || candidatePackages.length || validatedPackages.length);
}

function renderResearchRecommendationList(items, emptyMessage) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!values.length) return `<p class="small">${escapeHtml(emptyMessage)}</p>`;
  return `<ul class="research-recommendation-list">${values.map(item => `<li>${escapeHtml(String(item))}</li>`).join('')}</ul>`;
}

function renderResearchCaseRecommendation() {
  const recommendationState = state.triageOps.researchRecommendation || {};
  if (recommendationState.dismissed) {
    return `
      <section class="research-recommendation dismissed">
        <div><strong>Research-case recommendation dismissed</strong><p class="small">Nothing was created. You can restore the recommendation when the lead is ready for review.</p></div>
        <button class="mini-btn" id="research-recommendation-restore-btn" type="button">Show recommendation</button>
      </section>
    `;
  }
  const recommendation = recommendationState.data || null;
  const selectedAlert = selectedTriageOpsAlert();
  const cases = Array.isArray(state.researchCases.cases) ? state.researchCases.cases : [];
  const hasInput = researchRecommendationHasInput();
  const route = String(recommendation?.route || '');
  const canCreate = route === 'create_draft_case';
  const tokenReady = Boolean(state.researchCases.adminToken || state.triageOps.adminToken);
  const canLink = Boolean(selectedAlert?.finding_id && cases.length);
  const recommendationClass = route ? route.replace(/[^a-z0-9_-]/gi, '-').toLowerCase() : 'pending';
  return `
    <section class="research-recommendation ${recommendationClass}">
      <div class="research-recommendation-header">
        <div>
          <div class="detail-eyebrow">Research handoff</div>
          <h4>Research case recommendation</h4>
          <p class="small">Use the evaluator after discovery or Campaign Research. It recommends a durable draft when normalized package evidence is present, but it never decides maliciousness, disclosure, or publication.</p>
        </div>
        <button class="primary-btn" id="research-recommendation-btn" type="button" ${hasInput && !recommendationState.loading ? '' : 'disabled'}>${recommendationState.loading ? 'Evaluating…' : 'Suggest Research Case'}</button>
      </div>
      ${recommendationState.error ? `<div class="triage-output error"><strong>Recommendation failed</strong><p>${escapeHtml(recommendationState.error)}</p></div>` : ''}
      ${recommendation ? `
        <div class="research-recommendation-summary">
          <div><span class="small">Recommendation</span><strong>${escapeHtml(recommendation.label || statusLabel(route))}</strong></div>
          <div><span class="small">Confidence</span><strong>${escapeHtml(String(recommendation.confidence || 'unknown'))}</strong></div>
          <div><span class="small">Evidence score</span><strong>${escapeHtml(String(recommendation.score ?? '—'))}</strong></div>
          <div><span class="small">Source finding</span><strong><code>${escapeHtml(recommendation.checks?.source_finding_id || selectedAlert?.finding_id || 'none')}</code></strong></div>
        </div>
        <div class="research-recommendation-columns">
          <div><h5>Why</h5>${renderResearchRecommendationList(recommendation.reasons, 'No positive reasons recorded.')}</div>
          <div><h5>Blockers and cautions</h5>${renderResearchRecommendationList(recommendation.blockers, 'No blockers. Human review is still required.')}</div>
        </div>
        ${recommendation.suggested_case ? `
          <div class="research-recommendation-draft">
            <div><span class="small">Draft that would be created</span><strong>${escapeHtml(recommendation.suggested_case.title || 'Research case')}</strong><p class="small">${escapeHtml(recommendation.suggested_case.summary || '')}</p></div>
            <div class="research-recommendation-actions">
              <button class="primary-btn" id="research-recommendation-create-btn" type="button" ${canCreate && tokenReady ? '' : 'disabled'} title="${canCreate ? (tokenReady ? 'Creates a draft and seeds normalized subjects.' : 'Set the protected research action token first.') : 'Resolve the recommendation blockers before creating a draft.'}">Create draft case</button>
              <label class="research-recommendation-link-select"><span class="small">Existing case</span><select id="research-recommendation-existing-case" ${cases.length ? '' : 'disabled'}><option value="">Select a case to link…</option>${cases.map(item => `<option value="${escapeHtml(item.case_id)}">${escapeHtml(item.case_id)} · ${escapeHtml(item.title || 'Untitled')}</option>`).join('')}</select></label>
              <button class="secondary-btn" id="research-recommendation-link-btn" type="button" ${canLink ? '' : 'disabled'} title="${canLink ? 'Links the selected SCM finding to the selected research case.' : 'Select an SCM finding and make sure at least one research case is loaded.'}">Link existing case</button>
              <button class="mini-btn" id="research-recommendation-dismiss-btn" type="button">Dismiss recommendation</button>
            </div>
          </div>
        ` : ''}
      ` : `<div class="empty-state compact">${hasInput ? 'Run the evaluator to decide whether this lead belongs in a durable Research Case.' : 'Select a discovery candidate or add a normalized package before requesting a recommendation.'}</div>`}
      <p class="small research-recommendation-safety">Protected action boundary: creating a case makes a <strong>draft</strong> only. It does not publish, disclose, close, or change the original finding.</p>
    </section>
  `;
}

async function requestResearchCaseRecommendation(button = null) {
  if (!researchRecommendationHasInput()) {
    setStatus('Select a discovery candidate or add a package before requesting a research recommendation.', true);
    return;
  }
  const recommendationState = state.triageOps.researchRecommendation || {};
  recommendationState.loading = true;
  recommendationState.error = null;
  recommendationState.dismissed = false;
  renderTriageOps();
  setButtonBusy(el('research-recommendation-btn') || button, true, 'Evaluating…');
  try {
    const result = await fetchTriageOpsJson('research-recommendation', {
      method: 'POST',
      body: JSON.stringify(researchRecommendationPayload())
    });
    state.triageOps.researchRecommendation = {
      data: result.recommendation || null,
      dismissed: false,
      loading: false,
      error: null,
      stale: false
    };
    setStatus('<span class="dot"></span> Research-case recommendation ready');
  } catch (error) {
    state.triageOps.researchRecommendation = {
      ...recommendationState,
      loading: false,
      error: error?.message || String(error)
    };
    setStatus(`Research-case recommendation failed: ${error?.message || error}`, true);
  } finally {
    setButtonBusy(button, false);
    renderTriageOps();
  }
}

async function createDraftResearchCaseFromRecommendation(button = null) {
  const recommendation = state.triageOps.researchRecommendation?.data;
  const selectedAlert = selectedTriageOpsAlert();
  const token = state.researchCases.adminToken || state.triageOps.adminToken;
  if (!recommendation || recommendation.route !== 'create_draft_case') {
    setStatus('Resolve the research recommendation blockers before creating a draft case.', true);
    return;
  }
  if (!token) {
    setStatus('Set the protected research action token before creating a draft case.', true);
    el('research-cases-admin-token')?.focus();
    return;
  }
  const draft = recommendation.suggested_case || {};
  if (!(await requestConfirmation(`Create draft Research Case "${draft.title || 'Research lead'}"? It will remain a draft and require human review.`, {
    title: 'Create research case',
    context: 'The case will be created as a draft. No disclosure or publication action will occur.',
    confirmLabel: 'Create draft'
  }))) return;
  setButtonBusy(button, true, 'Creating…');
  try {
    const created = await runResearchCaseAction('create', {
      title: draft.title,
      summary: draft.summary,
      case_type: draft.case_type || 'supply_chain_campaign',
      severity: draft.severity || 'medium',
      confidence: draft.confidence || 'low',
      owner: draft.owner || 'SecOpsAI Research'
    }, button);
    const caseId = created?.result?.case_id || created?.case_id || created?.result?.case?.case_id || created?.case?.case_id;
    if (!caseId) throw new Error('Draft case was created but no case ID was returned. Refresh Research Cases to locate it.');

    const subjects = Array.isArray(draft.subjects) ? draft.subjects.slice(0, 20) : [];
    for (const subject of subjects) {
      await runResearchCaseAction('add-subject', {
        case_id: caseId,
        subject_type: subject.subject_type || 'package',
        ecosystem: subject.ecosystem || '',
        name: subject.name || '',
        version: subject.version || '',
        publisher: subject.publisher || '',
        actor: 'dashboard-operator'
      });
    }
    if (selectedAlert?.finding_id) {
      await runResearchCaseAction('link-finding', {
        case_id: caseId,
        finding_id: selectedAlert.finding_id,
        relationship: 'derived_from',
        actor: 'dashboard-operator'
      });
    }
    state.triageOps.researchRecommendation.dismissed = true;
    state.researchCases.selectedId = caseId;
    setStatus(`<span class="dot"></span> Draft ${escapeHtml(caseId)} created${selectedAlert?.finding_id ? ' and source finding linked' : ''}`);
    setPage('research-cases');
    await loadResearchCaseDetail(caseId, { render: false });
    renderResearchCases();
  } catch (error) {
    setStatus(`Draft research case creation failed: ${error?.message || error}`, true);
  } finally {
    setButtonBusy(button, false);
    renderTriageOps();
  }
}

async function linkExistingResearchCaseFromRecommendation(button = null) {
  const selectedAlert = selectedTriageOpsAlert();
  const caseId = el('research-recommendation-existing-case')?.value || '';
  if (!selectedAlert?.finding_id) {
    setStatus('Select an SCM finding before linking an existing research case.', true);
    return;
  }
  if (!caseId) {
    setStatus('Select an existing research case first.', true);
    return;
  }
  const result = await runResearchCaseAction('link-finding', {
    case_id: caseId,
    finding_id: selectedAlert.finding_id,
    relationship: 'derived_from',
    actor: 'dashboard-operator'
  }, button);
  if (result) {
    state.triageOps.researchRecommendation.dismissed = true;
    state.researchCases.selectedId = caseId;
    setStatus(`<span class="dot"></span> ${escapeHtml(selectedAlert.finding_id)} linked to ${escapeHtml(caseId)}`);
    setPage('research-cases');
    await loadResearchCaseDetail(caseId, { render: false });
    renderResearchCases();
  }
}

function renderCampaignResearchPanel() {
  const host = el('triage-ops-campaign-research');
  if (!host) return;
  const campaign = state.triageOps.campaign || defaultCampaignForm();
  const fixtures = state.triageOps.campaignFixtures || [];
  host.innerHTML = `
    <div class="card campaign-research-card">
      <div class="page-header compact-header">
        <div>
          <h3 style="margin:0;">Campaign Research</h3>
          <p class="small" style="margin:6px 0 0;">Use this only for validated package, extension, or supply-chain campaigns. Run Campaign Research once to get verdicts, correlations, local usage, mitigation, and references before any write action.</p>
        </div>
        <div class="campaign-fixture-actions">
          <select id="campaign-fixture-select">
            <option value="">Quick-load fixture…</option>
            ${fixtures.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title || item.id)}</option>`).join('')}
          </select>
          <button class="mini-btn" id="campaign-load-fixture-btn" type="button">Load fixture</button>
        </div>
      </div>

      <div class="campaign-form-grid">
        <label><span class="small">Campaign ID</span><input id="campaign-id-input" value="${escapeHtml(campaign.campaign_id || '')}" placeholder="deadcode09284814-infostealer-botnet-campaign" /></label>
        <label><span class="small">Title</span><input id="campaign-title-input" value="${escapeHtml(campaign.title || '')}" placeholder="Supply-chain infostealer campaign" /></label>
        <label><span class="small">Local search root</span><input id="campaign-search-root-input" value="${escapeHtml(campaign.search_root || '')}" placeholder="/Users/chrixchange/secopsai" /></label>
        <label class="campaign-wide"><span class="small">Summary</span><textarea id="campaign-summary-input" rows="3" placeholder="Brief analyst summary">${escapeHtml(campaign.summary || '')}</textarea></label>
      </div>

      <details class="campaign-review-drawer">
        <summary>Sources, IOCs, actors, and behavior indicators</summary>
        <div class="campaign-form-grid campaign-list-grid">
          ${renderCampaignListInputs('source_urls', 'Source URLs', 'https://source.example/report')}
          ${renderCampaignListInputs('source_names', 'Source names', 'OX Security, The Hacker News')}
          ${renderCampaignListInputs('actors', 'Actors', 'publisher or actor handle')}
          ${renderCampaignListInputs('publishers', 'Publishers', 'package publisher/namespace')}
          ${renderCampaignListInputs('iocs', 'IOCs', 'domain, IP, URL, repository description')}
          ${renderCampaignListInputs('behavioral_indicators', 'Behavioral indicators', 'credential theft, C2, persistence')}
        </div>
      </details>

      <div class="campaign-package-header">
        <div>
          <h4>Packages</h4>
          <p class="small">Add packages from npm, PyPI, crates, Packagist, Go, Hugging Face, Maven, NuGet, Open VSX, RubyGems, or Chrome Web Store local artifact mode.</p>
        </div>
        <div class="campaign-package-actions">
          <button class="secondary-btn" id="campaign-clean-noise-btn" type="button">Clean Obvious Package Noise</button>
          <button class="secondary-btn" id="campaign-add-package-btn" type="button">Add Package</button>
        </div>
      </div>
      <div class="campaign-packages">${renderCampaignPackageRows()}</div>

      <details class="campaign-json-box campaign-review-drawer">
        <summary>Import or inspect Campaign JSON</summary>
        <div class="campaign-list-head">
          <span class="small">Import Campaign JSON</span>
          <button class="secondary-btn" id="campaign-import-json-btn" type="button">Import Campaign JSON</button>
        </div>
        <textarea id="campaign-json-input" rows="7" placeholder='Paste campaign JSON here, then click Import Campaign JSON.'>${escapeHtml(campaign.jsonText || '')}</textarea>
        ${campaign.jsonError ? `<p class="form-error">${escapeHtml(campaign.jsonError)}</p>` : ''}
      </details>

      ${renderAutonomousDiscoveryPanel()}

      <div class="campaign-actions">
        <button class="primary-btn" id="campaign-run-btn" type="button">Run Campaign Research</button>
        <button class="secondary-btn" id="campaign-copy-cli-btn" type="button">Copy CLI Fallback</button>
        <button class="mini-btn" id="campaign-persist-btn" type="button">Persist Findings</button>
        <button class="primary-btn" id="campaign-blog-draft-btn" type="button">Create Campaign Blog Draft</button>
      </div>
      <p class="small campaign-action-hint">Run Campaign Research includes correlation and local usage review. Persist and blog draft actions stay token-gated and should only be used after the result is reviewed.</p>

      <div class="campaign-result-host">
        <h4>Campaign result</h4>
        ${renderCampaignResult(state.triageOps.campaignResult)}
        ${state.triageOps.campaignLastOutput?.cli ? `<details class="campaign-cli-output"><summary>Raw helper output (debug)</summary><pre>${escapeHtml(JSON.stringify(state.triageOps.campaignLastOutput.cli, null, 2))}</pre></details>` : ''}
      </div>
      ${renderResearchCaseRecommendation()}
    </div>
  `;
  host.querySelectorAll('[data-campaign-package-field="ecosystem"]').forEach(select => {
    const row = state.triageOps.campaign.packages?.[Number(select.closest('.campaign-package-row')?.dataset.campaignPackageIndex || 0)];
    if (row?.ecosystem) select.value = row.ecosystem;
  });
  host.querySelectorAll('input, textarea, select').forEach(input => {
    input.addEventListener('input', syncCampaignFormFromDom);
    input.addEventListener('change', syncCampaignFormFromDom);
  });
  host.querySelectorAll('.campaign-add-list-btn').forEach(btn => btn.addEventListener('click', () => {
    syncCampaignFormFromDom();
    const name = btn.dataset.campaignAddList;
    state.triageOps.campaign[name] = campaignArray(name).concat('');
    renderTriageOps();
  }));
  host.querySelectorAll('.campaign-remove-list-btn').forEach(btn => btn.addEventListener('click', () => {
    syncCampaignFormFromDom();
    const name = btn.dataset.campaignRemoveList;
    const index = Number(btn.dataset.campaignRemoveIndex || 0);
    const next = campaignArray(name).filter((_, idx) => idx !== index);
    state.triageOps.campaign[name] = next.length ? next : [''];
    renderTriageOps();
  }));
  el('campaign-add-package-btn')?.addEventListener('click', () => {
    syncCampaignFormFromDom();
    state.triageOps.campaign.packages.push({ ecosystem: 'npm', package: '', version: '', publisher: '', behavior_notes: '' });
    renderTriageOps();
  });
  el('campaign-clean-noise-btn')?.addEventListener('click', () => cleanCampaignPackageNoise());
  host.querySelectorAll('.campaign-remove-package-btn').forEach(btn => btn.addEventListener('click', () => {
    syncCampaignFormFromDom();
    const index = Number(btn.dataset.campaignRemovePackage || 0);
    const next = state.triageOps.campaign.packages.filter((_, idx) => idx !== index);
    state.triageOps.campaign.packages = next.length ? next : defaultCampaignForm().packages;
    renderTriageOps();
  }));
  el('campaign-import-json-btn')?.addEventListener('click', () => {
    try {
      const parsed = JSON.parse(el('campaign-json-input')?.value || '{}');
      setCampaignFormFromPayload(parsed.campaign || parsed);
      state.triageOps.campaignResult = null;
      renderTriageOps();
      setStatus('<span class="dot"></span> Campaign JSON imported');
    } catch (error) {
      state.triageOps.campaign.jsonError = `Invalid JSON: ${error.message}`;
      renderTriageOps();
    }
  });
  el('campaign-load-fixture-btn')?.addEventListener('click', () => {
    const selected = el('campaign-fixture-select')?.value || '';
    const fixture = fixtures.find(item => item.id === selected) || fixtures[0];
    if (!fixture?.campaign) return;
    setCampaignFormFromPayload(fixture.campaign);
    state.triageOps.campaignResult = null;
    renderTriageOps();
    setStatus(`<span class="dot"></span> Loaded campaign fixture: ${escapeHtml(fixture.title || fixture.id)}`);
  });
  el('campaign-run-btn')?.addEventListener('click', event => runCampaignEndpoint('research-campaign', { button: event.currentTarget }));
  el('research-recommendation-btn')?.addEventListener('click', event => requestResearchCaseRecommendation(event.currentTarget));
  el('research-recommendation-create-btn')?.addEventListener('click', event => createDraftResearchCaseFromRecommendation(event.currentTarget));
  el('research-recommendation-link-btn')?.addEventListener('click', event => linkExistingResearchCaseFromRecommendation(event.currentTarget));
  el('research-recommendation-dismiss-btn')?.addEventListener('click', () => {
    state.triageOps.researchRecommendation.dismissed = true;
    renderTriageOps();
    setStatus('<span class="dot"></span> Research-case recommendation dismissed for this session');
  });
  el('research-recommendation-restore-btn')?.addEventListener('click', () => {
    state.triageOps.researchRecommendation.dismissed = false;
    renderTriageOps();
  });
  el('campaign-persist-btn')?.addEventListener('click', event => runCampaignEndpoint('campaign-persist-findings', {
    button: event.currentTarget,
    write: true,
    confirmMessage: 'Persist campaign findings into the SecOpsAI SOC store? Review the research result before confirming.'
  }));
  el('campaign-blog-draft-btn')?.addEventListener('click', event => runCampaignEndpoint('campaign-blog-draft', {
    button: event.currentTarget,
    write: true,
    confirmMessage: 'Create a review-only campaign blog draft? This will not publish it.'
  }));
  el('campaign-copy-cli-btn')?.addEventListener('click', () => copyTextWithStatus(campaignCliFallback(), 'Campaign Research CLI fallback copied'));
  host.querySelectorAll('[data-campaign-candidate-id]').forEach(btn => btn.addEventListener('click', () => {
    state.triageOps.campaignDiscovery.selectedCandidateId = btn.dataset.campaignCandidateId || '';
    resetResearchCaseRecommendation();
    renderTriageOps();
  }));
  ['campaign-discovery-since', 'campaign-discovery-source', 'campaign-discovery-limit', 'campaign-discovery-min-score', 'campaign-watchlist-kind', 'campaign-watchlist-value'].forEach(id => {
    el(id)?.addEventListener('input', syncCampaignDiscoveryFromDom);
    el(id)?.addEventListener('change', syncCampaignDiscoveryFromDom);
  });
  el('campaign-discover-btn')?.addEventListener('click', event => runCampaignDiscoveryAction('campaign-discover', { button: event.currentTarget }));
  el('campaign-autopilot-dry-run-btn')?.addEventListener('click', event => runCampaignDiscoveryAction('campaign-autopilot', { button: event.currentTarget }));
  el('campaign-review-candidates-btn')?.addEventListener('click', async event => {
    setButtonBusy(event.currentTarget, true, 'Loading…');
    try {
      const payload = await fetchTriageOpsJson('campaign-candidates');
      state.triageOps.campaignCandidates = sortLatestFirst(payload.candidates || [], CAMPAIGN_CANDIDATE_LATEST_FIELDS);
      const selectedStillVisible = state.triageOps.campaignCandidates.some(candidate => String(candidate.candidate_id || '') === String(state.triageOps.campaignDiscovery.selectedCandidateId || ''));
      if ((!state.triageOps.campaignDiscovery.selectedCandidateId || !selectedStillVisible) && state.triageOps.campaignCandidates[0]) {
        state.triageOps.campaignDiscovery.selectedCandidateId = state.triageOps.campaignCandidates[0].candidate_id || '';
      } else if (!state.triageOps.campaignCandidates.length) {
        state.triageOps.campaignDiscovery.selectedCandidateId = '';
      }
      setStatus('<span class="dot"></span> Campaign candidates loaded');
      renderTriageOps();
    } catch (error) {
      setStatus(`Campaign candidates failed: ${error.message}`, true);
    } finally {
      setButtonBusy(event.currentTarget, false);
    }
  });
  el('campaign-orchestrate-btn')?.addEventListener('click', event => {
    const selected = selectedCampaignCandidate();
    if (!selected) {
      setStatus('Select a campaign candidate first.', true);
      return;
    }
    runCampaignDiscoveryAction('campaign-orchestrate', {
      button: event.currentTarget,
      body: { candidate: selected }
    });
  });
  el('campaign-promote-btn')?.addEventListener('click', event => {
    const selected = selectedCampaignCandidate();
    if (!selected) {
      setStatus('Select a campaign candidate first.', true);
      return;
    }
    runCampaignDiscoveryAction('campaign-promote', {
      button: event.currentTarget,
      body: { candidate_id: selected.candidate_id }
    });
  });
  el('campaign-watchlist-add-btn')?.addEventListener('click', event => {
    syncCampaignDiscoveryFromDom();
    const kind = state.triageOps.campaignDiscovery.watchlistKind || 'package';
    const value = state.triageOps.campaignDiscovery.watchlistValue || '';
    if (!value.trim()) {
      setStatus('Enter a package, publisher, IOC, or source URL before adding to the watchlist.', true);
      return;
    }
    runCampaignDiscoveryAction('campaign-watchlist', {
      button: event.currentTarget,
      write: true,
      body: { [kind]: value }
    });
  });
  host.querySelectorAll('.campaign-watchlist-suggestion').forEach(btn => btn.addEventListener('click', () => {
    syncCampaignDiscoveryFromDom();
    const kind = btn.dataset.watchlistKind || 'package';
    const value = btn.dataset.watchlistValue || '';
    state.triageOps.campaignDiscovery.watchlistKind = kind;
    state.triageOps.campaignDiscovery.watchlistValue = value;
    if (el('campaign-watchlist-kind')) el('campaign-watchlist-kind').value = kind;
    if (el('campaign-watchlist-value')) el('campaign-watchlist-value').value = value;
    setStatus(`<span class="dot"></span> Watchlist suggestion selected: ${escapeHtml(statusLabel(kind))} ${escapeHtml(value)}. Click Add to Watchlist to save it.`);
  }));
  el('campaign-discovery-copy-cli-btn')?.addEventListener('click', () => copyTextWithStatus(campaignDiscoveryCliFallback(), 'Campaign discovery CLI fallback copied'));
}

function triageOpsCliCommands(alert) {
  if (!alert) return [];
  const ecosystem = alert.ecosystem || 'pypi';
  const pkg = alert.package || '<package>';
  const version = alert.version || '<version>';
  const note = alert.recommendation?.recommended_note || 'Reviewed from Triage Ops dashboard.';
  return [
    'python3 -m secopsai.cli intel refresh',
    'python3 -m secopsai.cli triage summary',
    `python3 -m secopsai.cli triage investigate ${alert.finding_id} --json`,
    `python3 -m secopsai.cli supply-chain explain-verdict --ecosystem ${ecosystem} --package ${pkg} --version ${version}`,
    `python3 -m secopsai.cli supply-chain advisory check --ecosystem ${ecosystem} --package ${pkg} --version ${version}`,
    `python3 -m secopsai.cli triage close ${alert.finding_id} --disposition ${alert.recommendation?.recommended_disposition || 'false_positive'} --status closed --note "${String(note).replace(/"/g, '\\"')}"`
  ];
}

function renderTriageOpsStats() {
  const host = el('triage-ops-stats');
  if (!host) return;
  const alerts = state.triageOps.alerts || [];
  const actionable = alerts.filter(item => item.actionability?.is_actionable !== false);
  const cards = [
    ['SCM alerts', alerts.length, 'active supply-chain findings'],
    ['Actionable', actionable.length, 'needs operator work'],
    ['Open', alerts.filter(item => String(item.status || '').toLowerCase() === 'open').length, 'waiting for triage'],
    ['Actionable critical', actionable.filter(item => String(item.severity || '').toLowerCase() === 'critical').length, 'true-priority queue'],
    ['Ecosystem intelligence', alerts.filter(item => item.actionability?.bucket === 'ecosystem_intelligence').length, 'research and exposure checks'],
    ['Needs review', actionable.filter(item => item.recommendation?.recommended_disposition === 'needs_review').length, 'manual decision needed']
  ];
  host.innerHTML = cards.map(([label, value, sub]) => `
    <div class="card metric-card">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric">${escapeHtml(String(value))}</div>
      <div class="metric-label">${escapeHtml(sub)}</div>
    </div>
  `).join('');
}

function renderTriageOpsAlertList() {
  const host = el('triage-ops-alert-list');
  if (!host) return;
  const alerts = filteredTriageOpsAlerts();
  if (!alerts.length) {
    state.triageOps.selectedId = null;
    host.innerHTML = '<div class="empty-state">No active supply-chain intelligence matches this filter. Refresh evidence or adjust the filters.</div>';
    return;
  }
  const visibleIds = new Set(alerts.map(alert => String(alert.finding_id || '')));
  if (!visibleIds.has(String(state.triageOps.selectedId || ''))) {
    state.triageOps.selectedId = alerts[0].finding_id || null;
    state.triageOps.selectedDetail = null;
  }
  host.innerHTML = `<div class="triage-alert-list">${alerts.map(alert => {
    const selected = String(alert.finding_id || '') === String(state.triageOps.selectedId || '');
    const displaySeverity = alert.display_severity || alert.severity || 'critical';
    const scannerSeverity = String(alert.severity || '').toLowerCase();
    const displaySeverityText = String(displaySeverity || '').toLowerCase();
    return `
      <button class="triage-alert-card ${selected ? 'selected-row' : ''} triage-actionability-${escapeHtml(String(alert.actionability?.bucket || 'actionable'))}" data-triage-alert="${escapeHtml(alert.finding_id || '')}">
        <div class="triage-alert-topline">
          ${renderStatusPill(alert.status || 'open')}
          ${renderSeverityPill(displaySeverity)}
          ${scannerSeverity && scannerSeverity !== displaySeverityText ? `<span class="triage-rec-pill scanner-severity">Scanner: ${escapeHtml(scannerSeverity)}</span>` : ''}
          ${renderActionabilityPill(alert.actionability || {})}
          ${renderRecommendationPill(alert.recommendation || {})}
        </div>
        <h4>${escapeHtml(alert.title || alert.finding_id || 'Supply-chain alert')}</h4>
        <p>${escapeHtml(alert.summary || 'No summary available.')}</p>
        <div class="triage-alert-meta">
          <span>${escapeHtml(String(alert.ecosystem || '').toUpperCase())}</span>
          <span>${escapeHtml(alert.package || 'unknown')}@${escapeHtml(alert.version || 'unknown')}</span>
          <span>${escapeHtml(fmtDate(alert.last_seen || alert.first_seen))}</span>
        </div>
      </button>
    `;
  }).join('')}</div>`;
  host.querySelectorAll('.triage-alert-card').forEach(card => {
    card.addEventListener('click', () => {
      state.triageOps.selectedId = card.dataset.triageAlert;
      state.triageOps.selectedDetail = null;
      renderTriageOps();
    });
  });
}

function renderTriageOpsOutput(output) {
  if (!output) return '';
  if (output.error) {
    return `<div class="triage-output error"><strong>${escapeHtml(output.title || 'Last action failed')}</strong><p>${escapeHtml(output.error)}</p>${output.hint ? `<p>${escapeHtml(output.hint)}</p>` : ''}</div>`;
  }
  if (output.action === 'evidence-verdict') {
    return renderEvidenceVerdict(output.result || {});
  }
  if (output.action === 'evidence-bundle') {
    return renderEvidenceBundle(output.result || {});
  }
  const result = output.result || {};

  if (output.action === 'check-advisories') {
    const advisory = result.advisory || {};
    const matches = Array.isArray(advisory.matches) ? advisory.matches : [];
    const knownBad = Array.isArray(result.known_bad_versions) ? result.known_bad_versions : [];
    return `
      <div class="triage-output">
        <strong>Advisory Check Results</strong>
        <p class="small">Finding: ${escapeHtml(result.finding_id || '')}</p>
        <div class="evidence-section" style="margin-top: 10px;">
          <h4>Match Status: ${advisory.matched ? '<span style="color:#ff6b6b;font-weight:bold;">Matched</span>' : '<span style="color:#51cf66;">No matches</span>'}</h4>
          ${matches.length ? `
            <div class="evidence-list" style="margin-top: 8px;">
              ${matches.map(m => `
                <div class="evidence-row negative">
                  <strong>${escapeHtml(m.id || 'Advisory')}</strong>
                  <span>${escapeHtml(m.summary || '')}</span>
                  ${Array.isArray(m.source_urls) && m.source_urls.length ? `
                    <div style="margin-top: 4px; font-size: 0.85em;">
                      References: ${m.source_urls.map(url => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-color, #58a6ff); text-decoration:underline;">${escapeHtml(url)}</a>`).join(', ')}
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          ` : '<p class="small">No advisory database matches found for this package version.</p>'}
        </div>
        ${knownBad.length ? `
          <div class="evidence-section" style="margin-top: 10px;">
            <h4>Local Known-Bad Versions list</h4>
            <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
              ${knownBad.map(v => `<span class="triage-rec-pill true_positive">${escapeHtml(v)}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  if (output.action === 'check-local-usage') {
    const usage = result.usage || {};
    const matches = Array.isArray(usage.matches) ? usage.matches : [];
    return `
      <div class="triage-output">
        <strong>Local Repo Dependency Usage Check</strong>
        <p class="small">Finding: ${escapeHtml(result.finding_id || '')} • searched ${escapeHtml(String(usage.searched_files || 0))} files</p>
        <div class="evidence-section" style="margin-top: 10px;">
          <h4>Usage Status: ${usage.present ? '<span style="color:#ff6b6b;font-weight:bold;">Referenced locally</span>' : '<span style="color:#868e96;">Not referenced in manifests</span>'}</h4>
          ${matches.length ? `
            <div class="evidence-list" style="margin-top: 8px;">
              ${matches.map(m => `
                <div class="evidence-row ${m.version_match ? 'negative' : ''}">
                  <strong>Line ${m.line} in ${escapeHtml(m.path.split('/').pop())}</strong>
                  <code style="display:block; background: rgba(0,0,0,0.25); padding: 6px 10px; border-radius: 4px; margin-top:4px; font-family:monospace; font-size:0.9em; overflow-x:auto; white-space:pre; border: 1px solid rgba(255,255,255,0.05); color:#c9d1d9;">${escapeHtml(m.text)}</code>
                </div>
              `).join('')}
            </div>
          ` : '<p class="small">No reference to this package was found in pyproject.toml, requirements.txt, packagist, package.json, etc.</p>'}
        </div>
      </div>
    `;
  }

  if (output.action === 'generate-mitigation') {
    const mitigation = result.mitigation || {};
    const actions = Array.isArray(mitigation.actions) ? mitigation.actions : [];
    const commands = Array.isArray(mitigation.operator_commands) ? mitigation.operator_commands : [];
    return `
      <div class="triage-output">
        <strong>Recommended Mitigation Plan</strong>
        <p class="small">Finding: ${escapeHtml(result.finding_id || '')} • ${escapeHtml(mitigation.affected?.package || '')}@${escapeHtml(mitigation.affected?.version || '')}</p>
        <div class="evidence-section" style="margin-top: 10px;">
          <h4>Actions</h4>
          ${renderBulletList(actions, 'No mitigation actions returned.')}
        </div>
        ${commands.length ? `
          <div class="evidence-section" style="margin-top: 10px;">
            <h4>Operator Commands</h4>
            <pre class="triage-cli-fallback">${escapeHtml(commands.join('\n'))}</pre>
          </div>
        ` : ''}
      </div>
    `;
  }

  if (output.action === 'raw-report') {
    const reportText = result.text || '';
    return `
      <div class="triage-output">
        <strong>Raw Security Analysis Report</strong>
        <p class="small">Report path: <code>${escapeHtml(result.path || '')}</code> ${result.truncated ? '(truncated to 12KB)' : ''}</p>
        <pre style="background: var(--bg-card-dark, #161b22); padding: 12px; border-radius: 6px; font-family: monospace; font-size: 0.9em; white-space: pre-wrap; word-break: break-all; max-height: 400px; overflow-y: auto; border: 1px solid var(--border-color, #30363d); color: var(--text-color, #c9d1d9);">${escapeHtml(reportText)}</pre>
      </div>
    `;
  }

  if (output.action === 'investigate' || output.action === 'explain-verdict') {
    const detail = result.result || result;
    const stdout = output.result?.stdout || (typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
    return `
      <div class="triage-output">
        <strong>Analysis Output: ${escapeHtml(statusLabel(output.action))}</strong>
        <p class="small">Finding: ${escapeHtml(result.finding_id || '')}</p>
        <pre style="background: var(--bg-card-dark, #161b22); padding: 12px; border-radius: 6px; font-family: monospace; font-size: 0.9em; white-space: pre-wrap; max-height: 400px; overflow-y: auto; border: 1px solid var(--border-color, #30363d); color: var(--text-color, #c9d1d9);">${escapeHtml(stdout)}</pre>
      </div>
    `;
  }

  const primary =
    result.mitigation ||
    result.result?.investigation ||
    result.result ||
    result.advisory ||
    result.usage ||
    result;
  const summary = summarizeTriageActionOutput(output, primary);
  return `
    <div class="triage-output triage-output-compact">
      <strong>Last action: ${escapeHtml(statusLabel(output.action || 'status'))}</strong>
      <div class="triage-output-summary">
        ${summary.map(item => `<span>${escapeHtml(item)}</span>`).join('')}
      </div>
      ${renderRawActionDetails(primary)}
    </div>
  `;
}

function renderEvidenceRows(items = [], empty = 'None found') {
  const rows = Array.isArray(items) ? items.filter(Boolean).slice(0, 12) : [];
  if (!rows.length) return `<p class="small">${escapeHtml(empty)}</p>`;
  return `<div class="evidence-list">${rows.map(item => {
    if (typeof item === 'string') return `<div class="evidence-row"><strong>${escapeHtml(item)}</strong></div>`;
    return `
      <div class="evidence-row ${escapeHtml(String(item.weight || ''))}">
        <strong>${escapeHtml(item.label || item.kind || 'Evidence')}</strong>
        ${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ''}
      </div>
    `;
  }).join('')}</div>`;
}

function renderScoreBreakdown(items = []) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!rows.length) return `<p class="small">No score details returned.</p>`;
  return `<div class="score-breakdown-list">${rows.map(item => `
    <div class="score-breakdown-row">
      <span class="${Number(item.points || 0) >= 0 ? 'score-plus' : 'score-minus'}">${Number(item.points || 0) >= 0 ? '+' : ''}${escapeHtml(String(item.points || 0))}</span>
      <div><strong>${escapeHtml(item.label || 'Score item')}</strong><p>${escapeHtml(item.reason || '')}</p></div>
    </div>
  `).join('')}</div>`;
}

function renderEvidenceVerdict(verdict = {}) {
  const score = Number(verdict.score || 0);
  const packageVerdict = statusLabel(verdict.package_verdict || 'needs_review');
  const impact = statusLabel(verdict.environment_impact || 'unknown');
  const caution = /true positive/i.test(packageVerdict) && String(verdict.environment_impact || '') === 'not_observed'
    ? `<div class="evidence-notice">Package appears malicious or advisory-backed, but local exposure is not currently observed.</div>`
    : '';
  return `
    <div class="triage-output evidence-verdict-panel">
      <strong>Evidence-Based Verdict</strong>
      <div class="evidence-score-grid">
        <div class="evidence-score-card"><span>Package verdict</span><strong>${escapeHtml(packageVerdict)}</strong></div>
        <div class="evidence-score-card"><span>Environment impact</span><strong>${escapeHtml(impact)}</strong></div>
        <div class="evidence-score-card"><span>Confidence</span><strong>${escapeHtml(verdict.confidence || 'unknown')}</strong></div>
        <div class="evidence-score-card"><span>Score</span><strong>${escapeHtml(String(score))}/100</strong></div>
      </div>
      ${caution}
      <div class="evidence-section">
        <h4>Recommended disposition</h4>
        <p>${escapeHtml(statusLabel(verdict.recommended_disposition || 'needs_review'))}</p>
        <label class="blog-review-note"><span class="small">Copyable analyst note</span><textarea readonly rows="5">${escapeHtml(verdict.recommended_note || '')}</textarea></label>
      </div>
      <div class="evidence-section">
        <h4>Strong true-positive evidence</h4>
        ${renderEvidenceRows(verdict.true_positive_evidence, 'No strong true-positive evidence was extracted.')}
      </div>
      <div class="evidence-section">
        <h4>False-positive reducing evidence</h4>
        ${renderEvidenceRows(verdict.false_positive_evidence, 'No false-positive reducing evidence was extracted.')}
      </div>
      <div class="evidence-section">
        <h4>Missing evidence</h4>
        ${renderBulletList(verdict.missing_evidence || [], 'No missing evidence reported.')}
      </div>
      <div class="evidence-section">
        <h4>Score breakdown</h4>
        ${renderScoreBreakdown(verdict.score_breakdown || [])}
      </div>
      <div class="evidence-section">
        <h4>Mitigation actions</h4>
        ${renderBulletList(verdict.mitigation || [], 'No mitigation actions returned.')}
      </div>
      <div class="evidence-section">
        <h4>Operator commands</h4>
        <pre class="triage-cli-fallback">${escapeHtml((verdict.operator_commands || []).join('\n'))}</pre>
      </div>
    </div>
  `;
}

function renderEvidenceBundle(bundle = {}) {
  const results = bundle.results || {};
  const actionRows = (bundle.actions || Object.keys(results)).map(action => {
    const value = results[action];
    const failed = value && value.ok === false;
    return `
      <div class="evidence-row ${failed ? 'negative' : 'positive'}">
        <strong>${escapeHtml(statusLabel(action))}</strong>
        <span>${failed ? 'failed or unavailable' : 'completed'}</span>
      </div>
    `;
  }).join('');
  const verdict = results['evidence-verdict'] || {};
  const summary = {
    investigate: results.investigate?.result?.investigation || results.investigate?.result || results.investigate,
    explain_verdict: results['explain-verdict']?.result || results['explain-verdict'],
    advisory_check: results['check-advisories']?.advisory || results['check-advisories'],
    local_usage: results['check-local-usage']?.usage || results['check-local-usage'],
    raw_report: results['raw-report']?.report || results['raw-report']
  };
  return `
    <div class="triage-output evidence-bundle-panel">
      <strong>Automated Evidence Bundle</strong>
      <p class="small">${escapeHtml(bundle.ecosystem || 'ecosystem')}:${escapeHtml(bundle.package || 'package')}@${escapeHtml(bundle.version || 'version')} • ${escapeHtml(bundle.finding_id || 'selected alert')}</p>
      <div class="evidence-section">
        <h4>Completed read-only checks</h4>
        <div class="evidence-list">${actionRows}</div>
      </div>
      <div class="evidence-section">
        <h4>Evidence verdict</h4>
        ${renderEvidenceVerdict(verdict)}
      </div>
      <div class="evidence-section">
        <h4>Supporting outputs</h4>
        <pre class="triage-cli-fallback">${escapeHtml(JSON.stringify(summary, null, 2).slice(0, 16000))}</pre>
      </div>
    </div>
  `;
}

function renderTriageOpsDetail() {
  const host = el('triage-ops-detail');
  if (!host) return;
  const alert = selectedTriageOpsAlert();
  if (!alert) {
    host.innerHTML = `<div class="empty-state">Select an SCM alert to review its scanner rationale, recommendation, mitigation, and closure options.</div>${renderTriageOpsOutput(state.triageOps.lastOutput)}`;
    return;
  }
  const rec = alert.recommendation || {};
  const closeNote = state.triageOps.verdictNotes[alert.finding_id] || rec.recommended_note || `Reviewed ${alert.package}@${alert.version} from Triage Ops dashboard.`;
  const cliCommands = triageOpsCliCommands(alert);
  const actionability = alert.actionability || {};
  const isActionableAlert = actionability.is_actionable !== false;
  const displaySeverity = alert.display_severity || alert.severity || 'critical';
  const blogDraftDisabled = !isActionableAlert;
  host.innerHTML = `
    <div class="finding-detail-header">
      <div>
        <div class="detail-eyebrow">Supply-chain alert</div>
        <h4>${escapeHtml(alert.finding_id || '')}</h4>
        <p class="small">${escapeHtml(alert.package || 'unknown')}@${escapeHtml(alert.version || 'unknown')} • ${escapeHtml(alert.source || 'secopsai')}</p>
      </div>
      <div class="blog-preview-status-stack">
        ${renderStatusPill(alert.status || 'open')}
        ${renderSeverityPill(displaySeverity)}
        ${renderActionabilityPill(actionability)}
        ${renderRecommendationPill(rec)}
      </div>
    </div>
    ${actionability.bucket === 'ecosystem_intelligence' ? `<div class="triage-actionability-callout">${escapeHtml(actionability.reason || 'Package intelligence remains actionable while organization-wide exposure is checked.')}</div>` : ''}
    ${!isActionableAlert ? `<div class="triage-actionability-callout">Package evidence currently trends toward a false positive: ${escapeHtml(actionability.reason || 'Review the evidence before closure.')} Local absence is not the reason for this downgrade.</div>` : ''}
    <section class="triage-review-section">
      <div class="triage-section-heading">
        <span>Overview</span>
        <small>Identity, advisory state, local impact, and report path.</small>
      </div>
      <div class="kv-list triage-kv-grid">
        <div class="kv-row"><span class="kv-key">Ecosystem</span><span class="kv-val">${escapeHtml(alert.ecosystem || '—')}</span></div>
        <div class="kv-row"><span class="kv-key">Package</span><span class="kv-val">${escapeHtml(alert.package || '—')}</span></div>
        <div class="kv-row"><span class="kv-key">Version</span><span class="kv-val">${escapeHtml(alert.version || '—')}</span></div>
        <div class="kv-row"><span class="kv-key">Advisory match</span><span class="kv-val">${alert.advisory?.matched ? 'yes' : 'no'}</span></div>
        <div class="kv-row"><span class="kv-key">Local exposure</span><span class="kv-val">${alert.local_usage?.present ? `${alert.local_usage.match_count || 0} reference(s) observed` : 'not observed in this repository'}</span></div>
        <div class="kv-row"><span class="kv-key">Actionability</span><span class="kv-val">${escapeHtml(actionability.label || 'Actionable')}</span></div>
        <div class="kv-row"><span class="kv-key">Scanner severity</span><span class="kv-val">${escapeHtml(alert.severity || '—')}</span></div>
        <div class="kv-row"><span class="kv-key">Report</span><span class="kv-val">${escapeHtml(alert.report_path || '—')}</span></div>
      </div>
    </section>

    <section class="triage-review-section">
      <div class="triage-section-heading">
        <span>Evidence</span>
        <small>Scanner rationale and current recommendation evidence.</small>
      </div>
      <p class="triage-rationale">${escapeHtml(alert.analysis || alert.summary || 'No scanner rationale available.')}</p>
      ${renderBulletList(rec.evidence || [], 'No recommendation evidence loaded yet.')}
    </section>

    <section class="triage-review-section">
      <div class="triage-section-heading">
        <span>Analyst note & disposition</span>
        <small>Select close disposition and write note before protected actions.</small>
      </div>
      <div class="triage-ops-disposition-wrap" style="margin-bottom: 12px; display: flex; flex-direction: column; gap: 4px;">
        <span class="small" style="font-weight: 500;">Close disposition</span>
        <select id="triage-ops-disposition" style="background: var(--bg-input, #0d1117); color: var(--text-color, #c9d1d9); border: 1px solid var(--border-color, #30363d); border-radius: 6px; padding: 8px 12px; font-size: 0.9em; width: 100%;">
          <option value="false_positive" ${rec.recommended_disposition === 'false_positive' ? 'selected' : ''}>False positive</option>
          <option value="expected_behavior" ${rec.recommended_disposition === 'expected_behavior' ? 'selected' : ''}>Expected behavior</option>
          <option value="not_applicable" ${rec.recommended_disposition === 'not_applicable' ? 'selected' : ''}>Not applicable (No local usage)</option>
          <option value="tune_policy" ${rec.recommended_disposition === 'tune_policy' ? 'selected' : ''}>Tune policy</option>
          <option value="needs_review" ${rec.recommended_disposition === 'needs_review' ? 'selected' : ''}>Needs review</option>
        </select>
      </div>
      <label class="blog-review-note"><span class="small">Close / escalation note</span><textarea id="triage-ops-note" rows="4">${escapeHtml(closeNote)}</textarea></label>
    </section>

    <section class="triage-review-section">
      <div class="triage-section-heading">
        <span>Evidence actions</span>
        <small>Read-only checks that improve confidence before disposition.</small>
      </div>
      <div class="triage-ops-actions grouped">
        <button class="primary-btn" id="triage-ops-evidence-bundle-btn" type="button">Run Evidence Bundle</button>
        <button class="primary-btn triage-ops-action-btn" data-triage-action="evidence-verdict">Run Evidence Verdict</button>
        <button class="secondary-btn triage-ops-action-btn" data-triage-action="investigate">Investigate</button>
        <button class="secondary-btn triage-ops-action-btn" data-triage-action="explain-verdict">Explain verdict</button>
        <button class="secondary-btn triage-ops-action-btn" data-triage-action="check-advisories">Check advisory matches</button>
        <button class="secondary-btn triage-ops-action-btn" data-triage-action="check-local-usage">Check local repo usage</button>
        <button class="secondary-btn triage-ops-action-btn" data-triage-action="raw-report">Read raw report</button>
      </div>
    </section>

    <section class="triage-review-section">
      <div class="triage-section-heading">
        <span>Response actions</span>
        <small>Write actions remain token-gated and confirmation-backed.</small>
      </div>
      <div class="triage-ops-actions grouped response">
        <button class="secondary-btn triage-ops-action-btn" data-triage-action="generate-mitigation">Generate mitigation</button>
        <button class="mini-btn triage-ops-action-btn" data-triage-action="escalate" data-write="true">Move to in review</button>
        <button class="danger-btn triage-ops-action-btn" data-triage-action="close" data-write="true">Close finding</button>
        <button class="primary-btn triage-ops-action-btn" data-triage-action="create-blog-draft" data-write="true" ${blogDraftDisabled ? 'disabled title="Blog drafts are disabled only when package evidence currently supports a likely false positive."' : ''}>Create blog draft</button>
      </div>
    </section>

    <details class="triage-cli-drawer">
      <summary>CLI fallback</summary>
      <pre class="triage-cli-fallback">${escapeHtml(cliCommands.join('\n'))}</pre>
      <button class="mini-btn" id="triage-ops-copy-cli-btn">Copy CLI fallback</button>
    </details>
    ${renderTriageOpsOutput(state.triageOps.lastOutput)}
  `;
  host.querySelectorAll('.triage-ops-action-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.triageAction;
      const note = el('triage-ops-note')?.value || closeNote;
      const write = btn.dataset.write === 'true';
      const disposition = el('triage-ops-disposition')?.value || 'false_positive';
      if (action === 'close' && !(await requestConfirmation(`Close ${alert.finding_id} with disposition "${disposition}"? Review the note before confirming.`, {
        title: 'Close supply-chain finding',
        context: 'Closing changes the analyst disposition and will be recorded in the audit history.',
        confirmLabel: 'Close finding',
        danger: true
      }))) return;
      const payload = action === 'close'
        ? { disposition, status: 'closed', note }
        : action === 'escalate'
          ? { note }
          : {};
      runTriageOpsAction(action, { button: btn, write, payload });
    });
  });
  el('triage-ops-evidence-bundle-btn')?.addEventListener('click', event => runTriageOpsEvidenceBundle(event.currentTarget));
  el('triage-ops-copy-cli-btn')?.addEventListener('click', () => copyTextWithStatus(cliCommands.join('\n'), 'Triage Ops CLI fallback copied'));
}

function renderTriageOps() {
  const tokenInput = el('triage-ops-admin-token');
  if (tokenInput && tokenInput.value !== state.triageOps.adminToken) tokenInput.value = state.triageOps.adminToken;
  const authCard = document.querySelector('.triage-ops-auth-card .small');
  if (authCard) authCard.textContent = `${triageOpsAdminTokenHint()}. The helper runs allowlisted SecOpsAI commands; the browser never runs shell directly.`;
  renderTriageOpsStats();
  renderTriageOpsAlertList();
  renderCampaignResearchPanel();
  renderTriageOpsDetail();
}

function renderAll() {
  renderMissionControl();
  renderTasks();
  renderFindings();
  renderEdgeWorkspace();
  renderRunRequests();
  renderIntegrations();
  renderEnterprise();
  renderAutomation();
  renderTriageOps();
  renderResearchCases();
  renderBlogOps();
  renderSidebarSubnav(currentPageFromLocation());
  const triageSummary = localTriageSummary();
  const triageBit = triageSummary
    ? ` • local triage ${triageSummary.open_findings ?? 0} open / ${triageSummary.pending_actions ?? 0} pending / ${openLocalSessionsCount()} sessions`
    : '';
  setStatus(`<span class="dot"></span> Supabase connected • ${state.channelRoutes.length} routes loaded${triageBit}`);
}

async function loadTable(table, options = {}) {
  let query = supabaseClient.from(table).select(options.select || '*');
  if (options.orderBy) query = query.order(options.orderBy.column, { ascending: options.orderBy.ascending ?? false });
  if (options.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function resetTaskForm() {
  taskModalState.editingId = null;
  taskModalState.sourceFinding = null;
  el('task-modal-title').textContent = 'New task';
  el('task-title').value = '';
  el('task-domain').value = 'exec';
  el('task-priority').value = 'normal';
  el('task-status').value = 'inbox';
  // Ensure role pickers have options
  if (el('task-owner-role')) el('task-owner-role').innerHTML = ROLE_OPTIONS_HTML;
  if (el('task-reviewer-role')) el('task-reviewer-role').innerHTML = ROLE_OPTIONS_HTML;
  el('task-owner-role').value = '';
  el('task-reviewer-role').value = '';
  el('task-due-date').value = '';
  el('task-created-by').value = 'Techris';
  el('task-external-facing').checked = false;
  el('task-security-review').checked = false;
  el('task-description').value = '';
  el('task-delete-btn').classList.add('hidden');
  syncTaskStatusFieldMode(false);
}

function openTaskModal(item = null) {
  resetTaskForm();
  if (item) {
    taskModalState.editingId = item.id || null;
    taskModalState.sourceFinding = item.sourceFinding || taskModalState.sourceFinding || null;
    el('task-modal-title').textContent = 'Edit task';
    el('task-title').value = item.title || '';
    el('task-domain').value = item.domain || 'exec';
    el('task-priority').value = item.priority || 'normal';
    el('task-status').value = item.status || 'inbox';
    el('task-owner-role').value = item.owner_role || '';
    el('task-reviewer-role').value = item.reviewer_role || '';
    el('task-due-date').value = item.due_date || '';
    el('task-created-by').value = item.created_by || 'Techris';
    el('task-external-facing').checked = !!item.external_facing;
    el('task-security-review').checked = !!item.requires_security_review;
    el('task-description').value = item.description || '';
    el('task-delete-btn').classList.remove('hidden');
    syncTaskStatusFieldMode(true);
  }
  el('task-modal').classList.remove('hidden');
}

function closeTaskModal() { el('task-modal').classList.add('hidden'); }

function currentTaskModalItem() {
  return state.workItems.find(w => w.id === taskModalState.editingId) || null;
}
function syncTaskStatusFieldMode(isEditing) {
  const wrap = el('task-status-wrap');
  const help = el('task-status-help');
  if (wrap) wrap.classList.toggle('task-status-subtle', !isEditing);
  if (help) help.textContent = isEditing
    ? 'Update status here when the task has truly moved to a different workflow stage.'
    : 'New tasks default to Inbox. Change this only if you already know the task belongs elsewhere.';
}
function upsertWorkItemInState(item) {
  if (!item) return;
  const idx = state.workItems.findIndex(w => w.id === item.id);
  if (idx >= 0) state.workItems[idx] = item;
  else state.workItems.unshift(item);
}

function removeWorkItemFromState(taskId) {
  state.workItems = state.workItems.filter(w => w.id !== taskId);
}

function refreshTaskViewsOnly() {
  renderTasks();
  renderMissionControl();
  renderFindings();
}

async function advanceTaskAfterSuccessfulRun(itemId) {
  if (!itemId) return false;
  const task = state.workItems.find(w => String(w.id) === String(itemId));
  if (!task) return false;
  const nextStatus = task.reviewer_role ? 'review' : 'done';
  if (String(task.status || '').toLowerCase() === nextStatus) return false;
  const { data, error } = await supabaseClient
    .from('work_items')
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .select()
    .single();
  if (error) throw error;
  upsertWorkItemInState(data);
  return true;
}

async function synchronizeSuccessfulTaskTransitions() {
  const pendingTaskIds = [...new Set(state.runRequests
    .map(req => {
      const run = relatedRunForRequest(req);
      const lifecycle = runRequestLifecycle(req, run);
      return lifecycle.displayStatus === 'completed' ? req?.related_work_item_id : null;
    })
    .filter(Boolean)
    .map(id => String(id)))];
  if (!pendingTaskIds.length) return false;
  let changed = false;
  for (const taskId of pendingTaskIds) {
    try {
      const updated = await advanceTaskAfterSuccessfulRun(taskId);
      changed = changed || updated;
    } catch (e) {
      console.warn('synchronizeSuccessfulTaskTransitions failed', taskId, e);
    }
  }
  if (changed) refreshTaskViewsOnly();
  return changed;
}

function getRunRequestOutputRelativePath(req, run = relatedRunForRequest(req)) {
  const outputPath = firstNonEmpty(req?.output_path, run?.output_path);
  return outputPath ? String(outputPath).replace('/Users/chrixchange/.openclaw/workspace/', '') : '';
}

function isRecentRunRequest(req, maxAgeMs = 6 * 60 * 60 * 1000) {
  const stamp = req?.updated_at || req?.completed_at || req?.created_at;
  if (!stamp) return false;
  const ts = new Date(stamp).getTime();
  return Number.isFinite(ts) && (Date.now() - ts) <= maxAgeMs;
}

function shouldHydrateRunRequestOutput(req, run) {
  const lifecycle = runRequestLifecycle(req, run);
  if (!['completed', 'completed_with_gaps', 'needs_review', 'queued', 'running'].includes(lifecycle.displayStatus)) return false;
  const artifacts = parseRunRequestArtifacts(req, run);
  if (artifacts.commit || artifacts.prUrl || artifacts.prNumber || req?.fetched_output_text) return false;
  const rel = getRunRequestOutputRelativePath(req, run);
  if (!rel) return false;
  if (['queued', 'running'].includes(lifecycle.displayStatus)) return true;
  if (String(req?.status || '').toLowerCase() !== 'completed') return true;
  return isRecentRunRequest(req);
}

async function fetchRunOutputEvidence(rel, { force = false } = {}) {
  if (!rel) return null;
  const existing = state.outputEvidenceCache.get(rel);
  const now = Date.now();
  const freshForMs = force ? 0 : 10 * 60 * 1000;
  const failureBackoffMs = force ? 0 : 60 * 60 * 1000;
  if (existing?.text && (now - existing.fetchedAt) < freshForMs) return existing.text;
  if (existing?.pending) return existing.pending;
  if (!force && existing && !existing.text && (now - existing.fetchedAt) < failureBackoffMs) return null;

  const pending = dashboardApiFetch(getRunOutputEndpointUrl(rel))
    .then(resp => resp.json())
    .then(payload => {
      const text = payload?.ok && payload?.text ? payload.text : null;
      state.outputEvidenceCache.set(rel, { text, fetchedAt: Date.now(), pending: null });
      return text;
    })
    .catch(err => {
      state.outputEvidenceCache.set(rel, { text: null, fetchedAt: Date.now(), pending: null });
      throw err;
    });

  state.outputEvidenceCache.set(rel, { text: existing?.text || null, fetchedAt: existing?.fetchedAt || 0, pending });
  return pending;
}

async function hydrateRunRequestOutputEvidence() {
  const candidates = state.runRequests
    .map(req => ({ req, run: relatedRunForRequest(req) }))
    .filter(({ req, run }) => shouldHydrateRunRequestOutput(req, run))
    .sort((a, b) => new Date(b.req?.updated_at || b.req?.created_at || 0).getTime() - new Date(a.req?.updated_at || a.req?.created_at || 0).getTime())
    .slice(0, 4);
  if (!candidates.length) return false;

  let changed = false;
  await Promise.all(candidates.map(async ({ req, run }) => {
    const rel = getRunRequestOutputRelativePath(req, run);
    if (!rel) return;
    try {
      const text = await fetchRunOutputEvidence(rel);
      if (!text || req.fetched_output_text === text) return;
      req.fetched_output_text = text;
      changed = true;
    } catch (e) {
      // Intentionally quiet for background hydration.
    }
  }));
  return changed;
}

async function backgroundRefreshOpsData() {
  try {
    const [runs, events] = await Promise.all([
      loadTable('agent_runs', { orderBy: { column: 'created_at', ascending: false }, limit: 200 }),
      loadTable('dashboard_events', { orderBy: { column: 'created_at', ascending: false }, limit: 100 })
    ]);
    state.runs = runs;
    state.events = events;
    await loadLocalTriageState();
    renderMissionControl();
    renderIntegrations();
    renderFindings();
  } catch (e) {
    console.warn('background ops refresh failed', e);
  }
}

function edgeMetric(label, value, detail) {
  return `<div class="card metric-card"><div class="metric-label">${escapeHtml(label)}</div><div class="metric">${escapeHtml(String(value))}</div><div class="metric-label">${escapeHtml(detail)}</div></div>`;
}

function flattenCoreGraphNode(node) {
  const properties = node?.properties && typeof node.properties === 'object' ? node.properties : {};
  return { ...properties, ...node, id: node?.source_id || node?.node_id || properties.id };
}

function edgeAssetKey(asset = {}) {
  return String(asset.asset_id || asset.id || asset.ip_address || asset.label || '').trim();
}

function renderEdgeAssetDetail(assets = [], findings = [], changes = {}) {
  const host = el('edge-asset-detail');
  if (!host) return;
  const selected = assets.find(item => edgeAssetKey(item) === String(state.edgeWorkspace.selectedAssetId || ''));
  if (!selected) {
    host.innerHTML = '<div class="empty">Select an asset to inspect its observations, services, findings, and history.</div>';
    return;
  }
  const key = edgeAssetKey(selected);
  const relatedFindings = findings.filter(item => String(item.asset_id || item.ip_address || item.asset || '') === key || String(item.summary || '').includes(key));
  const assetChanges = [...(Array.isArray(changes.nodes) ? changes.nodes : []), ...(Array.isArray(changes.edges) ? changes.edges : [])].filter(item => String(item.asset_id || item.node_id || item.source_id || item.label || '').includes(key));
  const services = Array.isArray(selected.services) ? selected.services : (Array.isArray(selected.open_ports) ? selected.open_ports : []);
  host.innerHTML = `<div class="finding-detail-header"><div><div class="detail-eyebrow">Network asset</div><h4>${escapeHtml(selected.hostname || selected.ip_address || selected.label || key)}</h4><p class="small"><code>${escapeHtml(selected.ip_address || key)}</code> · ${escapeHtml(selected.vendor || 'Unknown vendor')} · ${escapeHtml(selected.device_type || selected.os_guess || 'Unknown type')}</p></div>${renderStatusPill(selected.status || 'active')}</div>
    <div class="kv-list"><div class="kv-row"><span class="kv-key">Last seen</span><span class="kv-val">${escapeHtml(fmtDate(selected.last_seen || selected.last_seen_at))}</span></div><div class="kv-row"><span class="kv-key">Services</span><span class="kv-val">${escapeHtml(String(services.length || selected.port_count || 0))}</span></div><div class="kv-row"><span class="kv-key">Related findings</span><span class="kv-val">${escapeHtml(String(relatedFindings.length))}</span></div></div>
    <div class="asset-detail-columns"><div><h5>Services</h5>${services.length ? `<ul class="compact-list">${services.slice(0, 30).map(item => `<li>${escapeHtml(typeof item === 'object' ? `${item.protocol || 'tcp'}/${item.port || item.service || 'unknown'}` : String(item))}</li>`).join('')}</ul>` : '<div class="small">No service observations recorded.</div>'}</div><div><h5>History</h5>${assetChanges.length ? `<ul class="compact-list">${assetChanges.slice(0, 20).map(item => `<li>${escapeHtml(item.type || item.edge_type || 'Observation')} · ${escapeHtml(fmtDate(item.updated_at || item.observed_at || item.created_at))}</li>`).join('')}</ul>` : '<div class="small">No asset-specific changes recorded.</div>'}</div></div>
    ${relatedFindings.length ? `<h5>Related findings</h5>${relatedFindings.slice(0, 10).map(item => `<div class="feed-item compact-feed-item"><strong>${escapeHtml(item.title || item.rule_name || item.finding_id || 'Finding')}</strong><div class="small">${escapeHtml(statusLabel(item.status || 'open'))} · ${escapeHtml(item.summary || '')}</div></div>`).join('')}` : ''}`;
}

function renderEdgeWorkspace() {
  const workspace = state.edgeWorkspace.data;
  const assetView = state.edgeWorkspace.view || 'inventory';
  const assetViewCopy = {
    inventory: ['Asset inventory', 'Review the current device inventory and its related Core findings.'],
    changes: ['Network changes', 'Trace new devices, missing devices, service changes, and observation history.'],
    sensors: ['Sensors', 'Check sensor connectivity, runtime state, version, and last error.'],
    schedules: ['Scans and schedules', 'Review recurring scan coverage and active scan jobs.'],
    wifi: ['Wi-Fi observations', 'Review reported wireless networks, BSSIDs, channels, and encryption state.']
  }[assetView] || ['Asset inventory', 'Review the current device inventory and its related Core findings.'];
  const assetSummary = el('asset-view-summary');
  if (assetSummary) assetSummary.innerHTML = `<span class="eyebrow">Asset workspace</span><strong>${escapeHtml(assetViewCopy[0])}</strong><span>${escapeHtml(assetViewCopy[1])}</span>`;
  const assetPage = el('page-edge');
  if (assetPage) assetPage.dataset.assetView = assetView;
  document.querySelectorAll('#page-edge [data-edge-section]').forEach(section => {
    const allowed = String(section.dataset.edgeSection || '').split(/\s+/).filter(Boolean);
    section.hidden = !allowed.includes(assetView);
  });
  const core = workspace?.core || {};
  const edge = workspace?.edge || {};
  const assets = Array.isArray(core.assets) ? core.assets : [];
  const findings = (Array.isArray(core.findings) ? core.findings : []).filter(item => (
    String(item.source || '').toLowerCase() === 'secopsai_edge'
    || String(item.finding_id || '').toUpperCase().startsWith('EDGE-')
  ));
  const coreSensors = (Array.isArray(core.sensors) ? core.sensors : []).map(flattenCoreGraphNode);
  const coreSites = (Array.isArray(core.sites) ? core.sites : []).map(flattenCoreGraphNode);
  const sensors = edge.ok && Array.isArray(edge.sensors) ? edge.sensors : coreSensors;
  const sites = edge.ok && Array.isArray(edge.sites) ? edge.sites : coreSites;
  const schedules = Array.isArray(edge.schedules) ? edge.schedules : [];
  const jobs = Array.isArray(edge.scan_jobs) ? edge.scan_jobs : [];
  const changes = core.changes && typeof core.changes === 'object' ? core.changes : { nodes: [], edges: [] };
  const syncState = Array.isArray(core.sync_state) ? core.sync_state : [];
  const latestSync = syncState[0] || null;
  const latestSyncAt = latestSync?.last_synced_at || null;
  const syncAgeMs = latestSyncAt ? Date.now() - Date.parse(latestSyncAt) : null;
  const syncStale = Number.isFinite(syncAgeMs) && syncAgeMs > 15 * 60 * 1000;
  const priority = findings.filter(item => ['critical', 'high'].includes(String(item.severity || '').toLowerCase())).length;
  const openFindings = findings.filter(item => !['closed', 'resolved'].includes(String(item.status || '').toLowerCase())).length;
  const onlineSensors = sensors.filter(item => String(item.connection_state || '').toLowerCase() === 'online').length;
  const activeSchedules = schedules.filter(item => item.enabled !== false).length;
  const activeJobs = jobs.filter(item => ['queued', 'claimed', 'running'].includes(String(item.status || '').toLowerCase())).length;

  const adminLink = el('edge-admin-link');
  if (adminLink) {
    const url = String(cfg.edgeDashboardUrl || '').trim();
    adminLink.hidden = !url;
    if (url) adminLink.href = url;
  }

  const health = el('edge-health');
  if (health) {
    if (state.edgeWorkspace.loading) {
      health.innerHTML = '<div class="small">Loading Core graph and Edge sensor health…</div>';
    } else if (!workspace) {
      health.innerHTML = `<div class="error">${escapeHtml(state.edgeWorkspace.error || 'Edge workspace has not loaded.')}</div>`;
    } else {
      health.innerHTML = `
        <div class="kv-list">
          <div class="kv-row"><div class="kv-key">Core graph & triage</div><div class="kv-val">${core.ok ? renderStatusPill('completed', 'Connected') : renderStatusPill('failed', 'Unavailable')}</div></div>
          <div class="kv-row"><div class="kv-key">Edge to Core sync</div><div class="kv-val">${latestSync ? renderStatusPill(syncStale ? 'in_review' : 'completed', syncStale ? 'Stale' : 'Current') : renderStatusPill('blocked', 'No sync recorded')}<div class="small">${latestSync ? `Last sync ${escapeHtml(fmtDate(latestSyncAt))}` : 'Run the supervised Edge sync before relying on Core graph freshness.'}</div></div></div>
          <div class="kv-row"><div class="kv-key">Edge operations API</div><div class="kv-val">${edge.ok ? renderStatusPill('completed', 'Live') : renderStatusPill(edge.configured ? 'failed' : 'blocked', edge.configured ? 'Unavailable' : 'Not configured')}</div></div>
          ${edge.credential ? `<div class="kv-row"><div class="kv-key">Edge credential</div><div class="kv-val">${renderStatusPill(edge.credential.rotation_recommended ? 'in_review' : 'completed', edge.credential.rotation_recommended ? 'Rotate soon' : 'Active')}<div class="small">Expires ${escapeHtml(fmtDate(edge.credential.expires_at))} · ${escapeHtml(String(edge.credential.expires_in_days))} day(s)</div></div></div>` : ''}
          <div class="kv-row"><div class="kv-key">Last refreshed</div><div class="kv-val">${escapeHtml(fmtDate(workspace.generated_at))}</div></div>
          ${core.error ? `<div class="error">${escapeHtml(core.error)}</div>` : ''}
          ${edge.error ? `<div class="small">${escapeHtml(edge.error)}</div>` : ''}
          ${edge.warning ? `<div class="warning">${escapeHtml(edge.warning)}</div>` : ''}
        </div>`;
    }
  }

  if (el('edge-stats')) el('edge-stats').innerHTML = [
    edgeMetric('Network assets', assets.length, 'Canonical Core graph'),
    edgeMetric('Open findings', openFindings, `${priority} high or critical`),
    edgeMetric('Sensors online', edge.ok ? `${onlineSensors}/${sensors.length}` : sensors.length, edge.ok ? `${sites.length} site(s)` : 'Synced sensor records'),
    edgeMetric('Active schedules', activeSchedules, `${activeJobs} active job(s)`),
    edgeMetric('Graph changes', (changes.nodes || []).length + (changes.edges || []).length, 'Recent nodes and relationships')
  ].join('');

  const sensorHost = el('edge-sensors');
  if (sensorHost) sensorHost.innerHTML = sensors.length ? `<div class="table-wrap"><table><thead><tr><th>Sensor</th><th>State</th><th>Runtime</th><th>Version</th><th>Last seen</th></tr></thead><tbody>${sensors.map(sensor => `<tr><td><strong>${escapeHtml(sensor.name || sensor.hostname || sensor.id)}</strong><div class="small">${escapeHtml(sensor.site_name || sensor.site_id || 'Unknown site')}</div></td><td>${renderStatusPill(sensor.connection_state || sensor.status || 'unknown')}</td><td>${escapeHtml(sensor.worker_state || 'unknown')}${sensor.current_job_id ? `<div class="small">Job ${escapeHtml(sensor.current_job_id)}</div>` : ''}</td><td>${escapeHtml(sensor.version || 'unknown')}<div class="small">${escapeHtml(sensor.os_name || '')}</div></td><td>${escapeHtml(fmtDate(sensor.last_seen_at))}${sensor.last_error ? `<div class="error">${escapeHtml(sensor.last_error)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No live sensor data. Configure the Edge API on the helper to enrich Core context.</div>';

  const scheduleHost = el('edge-schedules');
  if (scheduleHost) scheduleHost.innerHTML = schedules.length || jobs.length ? `<div class="table-wrap"><table><thead><tr><th>Name / target</th><th>State</th><th>Next / updated</th></tr></thead><tbody>${schedules.map(item => `<tr><td><strong>${escapeHtml(item.name || 'Schedule')}</strong><div class="small">${escapeHtml(item.target_cidr || '')}</div></td><td>${renderStatusPill(item.enabled === false ? 'blocked' : 'completed', item.enabled === false ? 'Disabled' : item.frequency || 'Enabled')}</td><td>${escapeHtml(fmtDate(item.next_run_at))}</td></tr>`).join('')}${jobs.filter(item => ['queued', 'claimed', 'running'].includes(String(item.status || '').toLowerCase())).map(item => `<tr><td><strong>Scan job</strong><div class="small">${escapeHtml(item.target_cidr || item.id)}</div></td><td>${renderStatusPill(item.status || 'queued')}</td><td>${escapeHtml(fmtDate(item.updated_at || item.created_at))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No schedules or active scan jobs loaded.</div>';

  const assetHost = el('edge-assets');
  if (assetHost) {
    assetHost.innerHTML = assets.length ? `<div class="table-wrap"><table class="mobile-card-table"><thead><tr><th>IP address</th><th>Hostname</th><th>Vendor / type</th><th>Status</th><th>Last seen</th><th>Action</th></tr></thead><tbody>${assets.map(asset => `<tr><td data-label="IP address"><code>${escapeHtml(asset.ip_address || asset.label || 'unknown')}</code></td><td data-label="Hostname">${escapeHtml(asset.hostname || 'Unknown')}</td><td data-label="Vendor / type">${escapeHtml(asset.vendor || 'Unknown')}<div class="small">${escapeHtml(asset.device_type || '')}</div></td><td data-label="Status">${renderStatusPill(asset.status || 'unknown')}</td><td data-label="Last seen">${escapeHtml(fmtDate(asset.last_seen))}</td><td data-label="Action"><button class="mini-btn edge-asset-select-btn" data-asset-id="${escapeHtml(edgeAssetKey(asset))}" type="button">Inspect</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No Edge assets are present in the Core graph yet.</div>';
    assetHost.querySelectorAll('.edge-asset-select-btn').forEach(button => button.addEventListener('click', () => { state.edgeWorkspace.selectedAssetId = button.dataset.assetId; renderEdgeAssetDetail(assets, findings, changes); }));
  }
  renderEdgeAssetDetail(assets, findings, changes);

  const findingHost = el('edge-findings');
  if (findingHost) findingHost.innerHTML = findings.length ? `<div class="table-wrap"><table><thead><tr><th>Finding</th><th>Severity</th><th>Status</th><th>Last seen</th></tr></thead><tbody>${findings.slice(0, 100).map(finding => `<tr><td><strong>${escapeHtml(finding.title || finding.rule_name || finding.finding_id)}</strong><div class="small"><code>${escapeHtml(finding.finding_id || '')}</code> · ${escapeHtml(finding.summary || '')}</div></td><td>${renderSeverityPill(finding.severity)}</td><td>${renderStatusPill(finding.status || 'open')}</td><td>${escapeHtml(fmtDate(finding.last_seen || finding.created_at))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No Edge-origin findings are present in Core triage.</div>';

  const changeHost = el('edge-changes');
  if (changeHost) {
    const rows = [...(Array.isArray(changes.nodes) ? changes.nodes : []).map(item => ({ kind: 'Node', label: item.label || item.node_id || item.id, at: item.updated_at || item.last_seen || item.created_at })), ...(Array.isArray(changes.edges) ? changes.edges : []).map(item => ({ kind: 'Relationship', label: item.type || item.edge_type || item.id, at: item.updated_at || item.observed_at || item.created_at }))];
    changeHost.innerHTML = rows.length ? `<div class="feed">${rows.slice(0, 30).map(item => `<div class="feed-item"><strong>${escapeHtml(item.kind)}</strong><div>${escapeHtml(item.label || 'Graph change')}</div><div class="meta">${escapeHtml(fmtDate(item.at))}</div></div>`).join('')}</div>` : '<div class="empty">No recent graph changes were returned.</div>';
    const timeline = el('edge-change-timeline');
    if (timeline) timeline.innerHTML = rows.length ? `<div class="timeline">${rows.slice(0, 50).map(item => `<div class="timeline-item"><span class="timeline-marker"></span><div><strong>${escapeHtml(item.label || 'Graph change')}</strong><div class="small">${escapeHtml(item.kind)} · ${escapeHtml(fmtDate(item.at))}</div></div></div>`).join('')}</div>` : '<div class="empty">No change timeline is available for this sync window.</div>';
  }
  const wifiHost = el('edge-wifi');
  const wifi = Array.isArray(edge.wifi_networks) ? edge.wifi_networks : (Array.isArray(core.wifi_networks) ? core.wifi_networks : []);
  if (wifiHost) wifiHost.innerHTML = wifi.length ? `<div class="table-wrap"><table><thead><tr><th>SSID</th><th>BSSID</th><th>Channel</th><th>Signal</th><th>Encryption</th><th>Observed</th></tr></thead><tbody>${wifi.slice(0, 100).map(item => `<tr><td><strong>${escapeHtml(item.ssid || 'Hidden SSID')}</strong></td><td><code>${escapeHtml(item.bssid || '—')}</code></td><td>${escapeHtml(String(item.channel || '—'))}</td><td>${escapeHtml(String(item.signal || item.rssi || '—'))}</td><td>${escapeHtml(item.encryption || 'Unknown')}</td><td>${escapeHtml(fmtDate(item.observed_at || item.created_at || item.timestamp))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No Wi-Fi observations were returned by the selected sensor.</div>';
}

async function loadEdgeWorkspace({ render = true } = {}) {
  state.edgeWorkspace.loading = true;
  state.edgeWorkspace.error = null;
  if (render) renderEdgeWorkspace();
  try {
    const response = await dashboardApiFetch(cfg.edgeWorkspaceEndpoint || '/api/secopsai/edge-workspace', { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (!payload || (!response.ok && !payload.core)) throw new Error(payload?.error || `Edge workspace HTTP ${response.status}`);
    state.edgeWorkspace.data = payload;
    state.edgeWorkspace.error = response.ok ? null : (payload.error || payload.core?.error || `HTTP ${response.status}`);
  } catch (error) {
    state.edgeWorkspace.data = null;
    state.edgeWorkspace.error = error?.message || String(error);
  } finally {
    state.edgeWorkspace.loading = false;
    if (render) renderEdgeWorkspace();
  }
  return state.edgeWorkspace.data;
}

function researchCasesEndpoint(suffix = '') {
  return `${cfg.researchCasesEndpoint || '/api/secopsai/research-cases'}${suffix}`;
}

function sandboxRecommendationsEndpoint() {
  return '/api/secopsai/research-sandbox-recommendations?limit=50';
}

async function loadResearchSandboxRecommendations({ render = true } = {}) {
  const queue = state.researchCases.sandboxRecommendations;
  queue.loading = true;
  queue.error = null;
  if (render) renderResearchCases();
  try {
    const response = await dashboardApiFetch(sandboxRecommendationsEndpoint(), { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Sandbox recommendation HTTP ${response.status}`);
    queue.recommendations = Array.isArray(payload.recommendations) ? payload.recommendations : [];
    queue.summary = payload.summary && typeof payload.summary === 'object' ? payload.summary : {};
  } catch (error) {
    queue.error = error?.message || String(error);
    queue.recommendations = [];
    queue.summary = null;
  } finally {
    queue.loading = false;
    if (render) renderResearchCases();
  }
  return queue;
}

async function verifyResearchSandboxProvider(button = null) {
  if (button) setButtonBusy(button, true, 'Checking…');
  try {
    const response = await dashboardApiFetch('/api/secopsai/sandbox-provider-status?verify=1', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Sandbox provider HTTP ${response.status}`);
    const provider = payload.provider && typeof payload.provider === 'object' ? payload.provider : {};
    state.researchCases.sandboxRecommendations.provider = provider;
    state.integrationStatus = {
      ...(state.integrationStatus || {}),
      sandbox: { ...(state.integrationStatus?.sandbox || {}), ...provider }
    };
    renderResearchCases();
    const health = String(provider.health || (provider.verified ? 'ready' : 'not_checked')).replaceAll('_', ' ');
    setStatus(`<span class="dot"></span> Tria.ge API check: ${escapeHtml(health)}`);
    return provider;
  } catch (error) {
    state.researchCases.sandboxRecommendations.provider = {
      ...(state.researchCases.sandboxRecommendations.provider || {}),
      health: 'unavailable',
      verified: false,
      verification_error: error?.message || String(error)
    };
    renderResearchCases();
    setStatus(`Tria.ge API check failed: ${error?.message || error}`, true);
    return null;
  } finally {
    if (button) setButtonBusy(button, false);
  }
}

function renderResearchSandboxProviderStatus() {
  const host = el('research-sandbox-provider-status');
  if (!host) return;
  const provider = state.researchCases.sandboxRecommendations.provider || state.integrationStatus?.sandbox || null;
  if (!provider) {
    host.innerHTML = '<div class="small">Tria.ge has not been checked. Verify the read-only API configuration before approving a submission.</div>';
    return;
  }
  const health = String(provider.health || (provider.verified ? 'ready' : provider.configured ? 'not_checked' : 'not_configured')).toLowerCase();
  const label = health === 'ready' ? 'Ready' : health === 'not_configured' ? 'Not configured' : health === 'unauthorized' ? 'Authentication failed' : health === 'unavailable' ? 'Unavailable' : health === 'invalid_configuration' ? 'Invalid configuration' : 'Not checked';
  const detail = provider.verified
    ? `Read-only API verified${provider.resource_count === null || provider.resource_count === undefined ? '' : ` · ${escapeHtml(String(provider.resource_count))} resources reported`}.`
    : health === 'not_configured'
      ? 'Set TRIAGE_API_TOKEN in the local helper to enable server-side submission; manual handoff remains available.'
      : provider.verification_error
        ? `Verification did not complete: ${escapeHtml(String(provider.verification_error).replaceAll('_', ' '))}.`
        : 'Configuration is present but has not been verified in this session.';
  host.innerHTML = `<div class="research-sandbox-provider-card"><div>${renderStatusPill(health)} <strong>Tria.ge</strong></div><p class="small">${detail}</p><p class="small">Public submissions are visible to the public. Approval and upload remain separate actions.</p></div>`;
}

const RESEARCH_CASE_ID_PATTERN = /^RSC-[A-F0-9]{12}$/i;

function researchOption(value, current, label = null) {
  return `<option value="${escapeHtml(value)}" ${String(value) === String(current) ? 'selected' : ''}>${escapeHtml(label || statusLabel(value))}</option>`;
}

function filteredResearchCases() {
  const status = el('research-filter-status')?.value || 'all';
  const query = (el('research-filter-search')?.value || '').trim().toLowerCase();
  return (state.researchCases.cases || []).filter(item => {
    if (status !== 'all' && String(item.status || '') !== status) return false;
    if (!query) return true;
    return [item.case_id, item.title, item.summary, item.owner, item.case_type]
      .some(value => String(value || '').toLowerCase().includes(query));
  });
}

function researchDownloadArtifact(artifact) {
  if (!artifact?.content) return;
  const blob = new Blob([artifact.content], { type: artifact.content_type || 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.filename || 'secopsai-research-case.md';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function loadResearchCaseDetail(caseId, { render = true } = {}) {
  if (!caseId) {
    state.researchCases.selected = null;
    if (render) renderResearchCases();
    return null;
  }
  const response = await dashboardApiFetch(researchCasesEndpoint(`/${encodeURIComponent(caseId)}`), { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Research case HTTP ${response.status}`);
  state.researchCases.selectedId = caseId;
  state.researchCases.selected = payload.case;
  if (render) renderResearchCases();
  return payload.case;
}

async function loadResearchCases({ render = true, preserveSelection = true } = {}) {
  state.researchCases.loading = true;
  state.researchCases.error = null;
  if (render) renderResearchCases();
  try {
    const response = await dashboardApiFetch(`${researchCasesEndpoint()}?limit=250`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Research cases HTTP ${response.status}`);
    state.researchCases.cases = Array.isArray(payload.cases) ? payload.cases : [];
    state.researchCases.resolution = payload.resolution && typeof payload.resolution === 'object'
      ? payload.resolution
      : { settings: {}, summary: {}, runs: [] };
    const retained = preserveSelection && state.researchCases.cases.some(item => item.case_id === state.researchCases.selectedId);
    state.researchCases.selectedId = retained ? state.researchCases.selectedId : (state.researchCases.cases[0]?.case_id || null);
    if (state.researchCases.selectedId) await loadResearchCaseDetail(state.researchCases.selectedId, { render: false });
    else state.researchCases.selected = null;
    // The sandbox queue is a separate read-only policy view. Keep its failure
    // isolated so a provider outage never hides the research case queue.
    await loadResearchSandboxRecommendations({ render: false });
  } catch (error) {
    state.researchCases.error = error?.message || String(error);
    state.researchCases.cases = [];
    state.researchCases.selected = null;
  } finally {
    state.researchCases.loading = false;
    if (render) renderResearchCases();
  }
}

async function openResearchCase(caseId) {
  const normalizedCaseId = String(caseId || '').trim().toUpperCase();
  state.researchCases.view = 'cases';
  state.researchCases.selectedId = normalizedCaseId || null;
  state.researchCases.selected = null;
  state.researchCases.error = null;
  state.researchCases.loading = true;
  setPage('research-cases', { routeOverride: RESEARCH_VIEW_ROUTES.cases, scrollToTarget: false });
  renderResearchCases();

  if (!RESEARCH_CASE_ID_PATTERN.test(normalizedCaseId)) {
    state.researchCases.error = normalizedCaseId
      ? `Research case ${normalizedCaseId} is invalid or unavailable.`
      : 'No research case ID was provided.';
    state.researchCases.loading = false;
    renderResearchCases();
    return false;
  }

  try {
    await loadResearchCases({ render: false, preserveSelection: true });
    await loadResearchCaseDetail(normalizedCaseId, { render: false });
    state.researchCases.error = null;
    return true;
  } catch (error) {
    state.researchCases.selected = null;
    state.researchCases.error = `Unable to open research case ${normalizedCaseId}: ${error?.message || String(error)}`;
    return false;
  } finally {
    state.researchCases.loading = false;
    renderResearchCases();
  }
}

async function loadResearchWatchlist({ render = true } = {}) {
  const watchlist = state.researchCases.watchlist;
  watchlist.loading = true;
  watchlist.error = null;
  if (render) renderResearchCases();
  try {
    const response = await dashboardApiFetch(cfg.researchWatchlistEndpoint || '/api/secopsai/research-watchlist', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Research watchlist HTTP ${response.status}`);
    watchlist.packages = Array.isArray(payload.packages) ? payload.packages : [];
  } catch (error) {
    watchlist.error = error?.message || String(error);
    watchlist.packages = [];
  } finally {
    watchlist.loading = false;
    if (render) renderResearchCases();
  }
}

function selectedResearchWatchlistPackages() {
  return Array.from(el('research-watchlist-packages')?.selectedOptions || [])
    .map(option => option.value)
    .filter(Boolean);
}

function renderResearchWatchlist() {
  const watchlist = state.researchCases.watchlist;
  const select = el('research-watchlist-packages');
  if (select) {
    const selected = new Set(selectedResearchWatchlistPackages());
    select.innerHTML = watchlist.packages.length
      ? watchlist.packages.map(item => `<option value="${escapeHtml(item.value)}" ${selected.has(item.value) ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')
      : '<option value="" disabled>No npm watchlist packages found</option>';
    select.disabled = watchlist.loading || !watchlist.packages.length;
  }
  const result = el('research-watchlist-result');
  if (!result) return;
  if (watchlist.loading) {
    result.innerHTML = '<div class="small">Loading npm watchlist…</div>';
    return;
  }
  if (watchlist.error) {
    result.innerHTML = `<div class="error">${escapeHtml(watchlist.error)}</div>`;
    return;
  }
  const payload = watchlist.result;
  if (!payload) {
    result.innerHTML = '<div class="small">No preview run yet.</div>';
    return;
  }
  const commandResult = payload.result || {};
  const selected = commandResult.selected || [];
  const created = commandResult.created || [];
  const existing = commandResult.existing || [];
  result.innerHTML = `<div class="research-watchlist-summary"><strong>${payload.action === 'create' ? 'Draft-case creation' : 'Preview'}</strong><span>${selected.length} selected</span><span>${created.length} created</span><span>${existing.length} already present</span></div>${selected.length ? `<div class="small">${selected.map(item => escapeHtml(item.package)).join(', ')}</div>` : '<div class="small">No packages matched.</div>'}`;
}

function researchDiscoveryEndpoint() {
  return cfg.researchDiscoveryEndpoint || '/api/secopsai/research-discovery';
}

async function loadResearchDiscovery({ render = true } = {}) {
  const discovery = state.researchCases.discovery;
  discovery.loading = true;
  discovery.error = null;
  if (render) renderResearchCases();
  try {
    const [capabilities, watchlists, monitors, candidates, alerts, campaigns, promotionPolicy] = await Promise.all([
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=capabilities`, { cache: 'no-store' }).then(response => response.json()),
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=watchlists`, { cache: 'no-store' }).then(response => response.json()),
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=monitors`, { cache: 'no-store' }).then(response => response.json()),
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=candidates`, { cache: 'no-store' }).then(response => response.json()),
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=alerts`, { cache: 'no-store' }).then(response => response.json()),
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=campaigns`, { cache: 'no-store' }).then(response => response.json()),
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=promotion-policy&ecosystem=${encodeURIComponent(el('research-promotion-ecosystem')?.value || 'all')}`, { cache: 'no-store' }).then(response => response.json())
    ]);
    if (capabilities.ok === false || watchlists.ok === false || monitors.ok === false || candidates.ok === false || alerts.ok === false || campaigns.ok === false || promotionPolicy.ok === false) throw new Error(capabilities.error || watchlists.error || monitors.error || candidates.error || alerts.error || campaigns.error || promotionPolicy.error || 'Research discovery unavailable');
    discovery.capabilities = capabilities.result || null;
    discovery.watchlists = watchlists.result?.watchlists || [];
    discovery.monitors = monitors.result?.monitors || [];
    discovery.candidates = candidates.result?.candidates || [];
    discovery.alerts = alerts.result?.alerts || [];
    discovery.campaigns = campaigns.result?.campaigns || [];
    discovery.promotionPolicy = promotionPolicy.result || null;
  } catch (error) {
    discovery.error = error?.message || String(error);
  } finally {
    discovery.loading = false;
    if (render) renderResearchCases();
  }
}

const researchDiscoveryActionQueues = new Map();

function researchActionQueueKey(prefix, action, payload = {}) {
  const recordId = payload.case_id || payload.alert_id || payload.monitor_id || payload.collector_id || '';
  // All writes for one case/alert must share a queue. Including the action
  // name here would allow a verdict and a workflow update to race again.
  return `${prefix}:${String(recordId || 'workspace').trim().toLowerCase()}`;
}

function enqueueResearchAction(queueMap, key, task) {
  const previous = queueMap.get(key) || Promise.resolve();
  const current = previous.catch(() => null).then(task);
  queueMap.set(key, current);
  current.finally(() => {
    if (queueMap.get(key) === current) queueMap.delete(key);
  }).catch(() => {});
  return current;
}

async function runResearchDiscoveryAction(action, payload = {}, button = null) {
  const key = researchActionQueueKey('discovery', action, payload);
  return enqueueResearchAction(researchDiscoveryActionQueues, key, () => runResearchDiscoveryActionNow(action, payload, button));
}

async function runResearchDiscoveryActionNow(action, payload = {}, button = null) {
  const token = state.researchCases.adminToken || state.triageOps.adminToken;
  if (!token) {
    setStatus('Use the protected research action token before changing discovery state.', true);
    el('research-cases-admin-token')?.focus();
    return null;
  }
  setButtonBusy(button, true, 'Working…');
  try {
    const response = await dashboardApiFetch(researchDiscoveryEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Triage-Ops-Admin-Token': token },
      body: JSON.stringify({ action, ...payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || result.result?.error || `Discovery action HTTP ${response.status}`);
    state.researchCases.discovery.lastAction = { action, result, at: new Date().toISOString() };
    await loadResearchDiscovery({ render: false });
    if (action === 'alert-resolve' && payload.alert_id) {
      const alert = (state.researchCases.discovery.alerts || []).find(item => String(item.alert_id) === String(payload.alert_id));
      if (!alert || String(alert.status || '').toLowerCase() !== 'resolved') {
        throw new Error(`Core did not confirm alert ${payload.alert_id} as resolved`);
      }
    }
    renderResearchCases();
    setStatus(`<span class="dot"></span> Research discovery ${escapeHtml(action)} completed`);
    await refreshAfterAction({ key: `research-discovery:${action}` });
    return result;
  } catch (error) {
    state.researchCases.discovery.error = error?.message || String(error);
    setStatus(`Research discovery failed: ${escapeHtml(state.researchCases.discovery.error)}`, true);
    notifyError(`Research discovery failed: ${state.researchCases.discovery.error}`);
    return null;
  } finally {
    setButtonBusy(button, false);
  }
}

async function loadPromotionPolicyForEcosystem(ecosystem) {
  try {
    const response = await dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=promotion-policy&ecosystem=${encodeURIComponent(ecosystem || 'all')}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Promotion policy HTTP ${response.status}`);
    state.researchCases.discovery.promotionPolicy = payload.result || null;
    renderResearchPromotionPolicy();
  } catch (error) {
    setStatus(`Promotion policy could not be loaded: ${escapeHtml(error.message || String(error))}`, true);
  }
}

function syncResearchDiscoveryWatchlistOptions() {
  const discovery = state.researchCases.discovery;
  const watchlistSelect = el('research-discovery-watchlist-id');
  if (!watchlistSelect) return;
  const current = watchlistSelect.value;
  const selectedEcosystem = el('research-discovery-ecosystem')?.value || '';
  const options = discovery.watchlists.filter(item => !selectedEcosystem || item.ecosystem === selectedEcosystem);
  watchlistSelect.innerHTML = options.length
    ? options.map(item => `<option value="${escapeHtml(item.watchlist_id)}">${escapeHtml(item.ecosystem)} · ${escapeHtml(item.identifier)}</option>`).join('')
    : `<option value="">Add a ${escapeHtml(selectedEcosystem || 'matching')} watchlist first</option>`;
  if (options.some(item => item.watchlist_id === current)) watchlistSelect.value = current;
}

function renderResearchDiscovery() {
  const discovery = state.researchCases.discovery;
  const health = el('research-discovery-health');
  const candidatesHost = el('research-discovery-candidates');
  if (!health || !candidatesHost) return;
  if (discovery.loading) {
    health.innerHTML = '<div class="empty-state compact">Loading discovery health…</div>';
    candidatesHost.innerHTML = '';
    return;
  }
  if (discovery.error) {
    health.innerHTML = `<div class="error">${escapeHtml(discovery.error)}</div>`;
    candidatesHost.innerHTML = '<div class="small">Discovery data is unavailable. Check the local Core helper and refresh.</div>';
    return;
  }
  const ecosystems = discovery.capabilities?.ecosystems || [];
  health.innerHTML = [
    edgeMetric('Ecosystems', ecosystems.length, 'Capability registry'),
    edgeMetric('Watchlists', discovery.watchlists.length, 'Active scopes'),
    edgeMetric('Monitors', discovery.monitors.length, 'Due and scheduled'),
    edgeMetric('Open alerts', discovery.alerts.filter(item => item.status === 'open').length, 'Candidate delivery queue'),
  ].join('');
  syncResearchDiscoveryWatchlistOptions();
  const candidates = discovery.candidates || [];
  const candidateMarkup = candidates.length
    ? `<div class="table-wrap"><table><thead><tr><th>Candidate</th><th>Ecosystem</th><th>Score</th><th>Why</th><th>Status</th></tr></thead><tbody>${candidates.slice(0, 25).map(item => `<tr><td><strong>${escapeHtml(item.package)}</strong><div class="small">${escapeHtml(item.version)} vs ${escapeHtml(item.reference_identifier)}</div></td><td>${escapeHtml(item.ecosystem)}</td><td>${escapeHtml(String(item.score))}</td><td>${escapeHtml(item.reason || 'Similarity requires analyst review')}</td><td>${escapeHtml(statusLabel(item.status))}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state compact">No candidates yet. Add a watchlist, run a monitor, and review the resulting scoped candidates.</div>';
  const alertMarkup = discovery.alerts.length ? `<h4>Research alerts</h4><div class="table-wrap"><table><thead><tr><th>Alert</th><th>Severity</th><th>Reason</th><th>Status</th><th>Actions</th></tr></thead><tbody>${discovery.alerts.slice(0, 15).map(item => `<tr><td><code>${escapeHtml(item.alert_id)}</code></td><td>${escapeHtml(statusLabel(item.severity))}</td><td>${escapeHtml(humanizeMachineText(item.reason || 'Review candidate'))}</td><td>${escapeHtml(statusLabel(item.status))}</td><td><div style="display: flex; gap: 8px;"><button class="mini-btn research-alert-deliver-btn" data-alert-id="${escapeHtml(item.alert_id)}" type="button">Email</button>${item.status === 'open' ? `<button class="mini-btn research-alert-resolve-btn" data-alert-id="${escapeHtml(item.alert_id)}" type="button">Resolve</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : '';
  candidatesHost.innerHTML = candidateMarkup + alertMarkup;
  renderResearchStageQueues(candidates);
  renderResearchPromotionPolicy();
  renderResearchCampaigns();
}

function renderResearchPromotionPolicy() {
  const policy = state.researchCases.discovery.promotionPolicy || {};
  const statePill = el('research-promotion-state');
  if (statePill) statePill.textContent = policy.enabled ? 'Enabled' : 'Disabled';
  if (el('research-promotion-score')) el('research-promotion-score').value = String(policy.score_threshold ?? 90);
  if (el('research-promotion-evidence')) el('research-promotion-evidence').value = String(policy.minimum_evidence ?? 2);
  if (el('research-promotion-mode')) el('research-promotion-mode').value = policy.mode || 'draft_case';
  if (el('research-promotion-enabled')) el('research-promotion-enabled').checked = Boolean(policy.enabled);
  if (el('research-promotion-publisher')) el('research-promotion-publisher').checked = Boolean(policy.require_publisher);
  const last = state.researchCases.discovery.lastAction;
  const result = el('research-promotion-result');
  if (result && last && String(last.action || '').startsWith('promotion-policy')) {
    const data = last.result?.result || last.result || {};
    result.innerHTML = `<div class="small"><strong>${escapeHtml(statusLabel(last.action))}</strong> · evaluated ${escapeHtml(String(data.evaluated ?? 0))} · eligible ${escapeHtml(String(data.eligible ?? 0))} · draft cases created ${escapeHtml(String(data.promoted ?? 0))}</div>`;
  }
}

function renderResearchCampaigns() {
  const host = el('research-campaigns-list');
  if (!host) return;
  const campaigns = state.researchCases.discovery.campaigns || [];
  host.innerHTML = campaigns.length ? researchTable(['Campaign', 'Confidence', 'Attribution', 'Status', 'Updated'], campaigns.map(item => `<tr><td><strong>${escapeHtml(item.title || item.campaign_id)}</strong><div class="small"><code>${escapeHtml(item.campaign_id)}</code></div></td><td>${escapeHtml(String(item.confidence ?? '—'))}%</td><td>${escapeHtml(item.attribution || 'Not attributed')}</td><td>${renderStatusPill(item.status || 'candidate')}</td><td>${escapeHtml(fmtDate(item.updated_at))}</td></tr>`), '') : '<div class="empty-state compact">No campaign clusters exist yet. Correlation creates candidate relationships; it does not establish attribution.</div>';
}

function renderResearchSandboxQueue(cases) {
  const host = el('research-sandbox-queue');
  renderResearchSandboxProviderStatus();
  if (!host) return;
  const queue = state.researchCases.sandboxRecommendations || {};
  if (queue.loading && !queue.recommendations?.length) {
    host.innerHTML = '<div class="empty-state compact">Evaluating cases for dynamic-analysis need…</div>';
    return;
  }
  if (queue.error && !queue.recommendations?.length) {
    host.innerHTML = `<div class="empty-state compact">Sandbox recommendations unavailable: ${escapeHtml(queue.error)}. The case workflow remains available.</div>`;
    return;
  }
  const recommendations = Array.isArray(queue.recommendations) ? queue.recommendations : [];
  if (recommendations.length) {
    host.innerHTML = researchTable(
      ['Case', 'Assessment', 'Recommendation', 'Exact artifact', 'Next action'],
      recommendations.map(item => {
        const recommendation = item.recommendation || {};
        const status = recommendation.status || 'unknown';
        const artifact = recommendation.artifact_sha256
          ? `${String(recommendation.artifact_sha256).slice(0, 16)}…`
          : 'Not attached';
        const reasons = Array.isArray(recommendation.reasons) ? recommendation.reasons.slice(0, 2).join(' ') : '';
        return `<tr><td><button class="mini-btn research-sandbox-open-case-btn" data-case-id="${escapeHtml(item.case_id)}" type="button">Open case</button><div><strong>${escapeHtml(item.title || item.case_id)}</strong></div><div class="small"><code>${escapeHtml(item.case_id)}</code> · ${escapeHtml(fmtDate(item.updated_at))}</div></td><td>${renderSeverityPill(item.severity || 'medium')}<div class="small">${escapeHtml(humanizeSnake(item.assessment || 'unconfirmed'))}</div></td><td>${renderStatusPill(status)}<div class="small">${escapeHtml(reasons || recommendation.next_action || 'Review the policy result.')}</div></td><td><code>${escapeHtml(artifact)}</code></td><td><span class="small">${escapeHtml(recommendation.next_action || 'Review the case.')}</span></td></tr>`;
      }),
      'No cases currently need dynamic analysis.'
    );
  } else {
    const existing = (cases || []).filter(item => Number(item.sandbox_count || 0) > 0 || ['sandbox_pending', 'sandbox_review'].includes(String(item.status || '').toLowerCase()));
    host.innerHTML = existing.length
      ? researchTable(['Case', 'Sandbox jobs', 'State', 'Updated'], existing.map(item => `<tr><td><button class="mini-btn research-sandbox-open-case-btn" data-case-id="${escapeHtml(item.case_id)}" type="button">Open case</button><div><strong>${escapeHtml(item.title || item.case_id)}</strong></div><div class="small"><code>${escapeHtml(item.case_id)}</code></div></td><td>${escapeHtml(String(item.sandbox_count || 0))}</td><td>${escapeHtml(statusLabel(item.status || 'review'))}</td><td>${escapeHtml(fmtDate(item.updated_at))}</td></tr>`), 'No sandbox jobs are waiting for approval or review.')
      : '<div class="empty-state compact">No cases currently meet the dynamic-analysis recommendation policy. Static evidence remains the default; a recommendation appears only when runtime evidence could materially change the decision.</div>';
  }
  host.querySelectorAll('.research-sandbox-open-case-btn').forEach(button => button.addEventListener('click', () => openResearchCase(button.dataset.caseId)));
}

function renderResearchStageQueues(candidates = []) {
  const inbox = el('research-inbox-candidates');
  if (inbox) {
    const ranked = [...candidates].sort((left, right) => {
      const leftEvidence = Object.values(left.evidence || {}).filter(Boolean).length;
      const rightEvidence = Object.values(right.evidence || {}).filter(Boolean).length;
      return (Number(right.score || 0) + rightEvidence * 3) - (Number(left.score || 0) + leftEvidence * 3);
    });
    inbox.innerHTML = ranked.length ? ranked.slice(0, 30).map((item, index) => {
      const evidenceCount = Object.values(item.evidence || {}).filter(Boolean).length;
      const completeness = Math.min(100, Math.round((evidenceCount / 3) * 100));
      const novelty = String(item.status || 'new').toLowerCase() === 'new' ? 'New lead' : statusLabel(item.status || 'review');
      const impact = Number(item.score || 0) >= 95 ? 'Critical review priority' : Number(item.score || 0) >= 85 ? 'High review priority' : 'Standard review priority';
      return `
      <article class="research-inbox-card">
        <div class="research-inbox-card-head"><strong>#${index + 1} · ${escapeHtml(item.package || item.identifier || 'Candidate')}</strong><span class="status-pill">Score ${escapeHtml(String(item.score ?? '—'))}</span></div>
        <div class="small">${escapeHtml(item.ecosystem || 'unknown')} · ${escapeHtml(item.version || 'version unknown')} · reference ${escapeHtml(item.reference_identifier || 'not recorded')}</div>
        <p>${escapeHtml(item.reason || 'Explainable similarity requires analyst review.')}</p>
        <div class="research-candidate-facts"><span>${escapeHtml(novelty)}</span><span>${escapeHtml(impact)}</span><span>Evidence ${completeness}%</span><span>Coverage ${escapeHtml(item.coverage || 'scoped')}</span></div>
      </article>`;
    }).join('') : '<div class="empty-state compact">No candidates are waiting for review. A scoped monitor with no candidates is not a global clean result.</div>';
  }
  const cases = state.researchCases.cases || [];
  const disclosure = el('research-disclosure-queue');
  const disclosureCases = cases.filter(item => ['disclosure_pending', 'coordinating'].includes(String(item.status || '').toLowerCase()) || ['reported', 'coordinating'].includes(String(item.disclosure_status || '').toLowerCase()));
  if (disclosure) disclosure.innerHTML = disclosureCases.length ? researchTable(['Case', 'State', 'Owner', 'Updated'], disclosureCases.map(item => `<tr><td><strong>${escapeHtml(item.title || item.case_id)}</strong><div class="small"><code>${escapeHtml(item.case_id)}</code></div></td><td>${escapeHtml(statusLabel(item.disclosure_status || item.status || 'pending'))}</td><td>${escapeHtml(item.owner || 'Unassigned')}</td><td>${escapeHtml(fmtDate(item.updated_at))}</td></tr>`), '') : '<div class="empty-state compact">No cases currently require disclosure coordination.</div>';
  renderResearchSandboxQueue(cases);
}

function formatCoverageLag(lagSeconds) {
  if (lagSeconds === null || lagSeconds === undefined) return '—';
  const seconds = Number(lagSeconds);
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 120) return `${Math.round(seconds)}s`;
  if (seconds < 7200) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function coverageCollectorHealth(collector) {
  if (!collector.enabled) return 'Paused';
  const state = String(collector.coverage_state || '').toLowerCase();
  if (state === 'retention_risk') return 'Retention risk';
  if (state === 'failed') return 'Last run failed';
  if (state === 'dead_letters') return 'Dead letters pending';
  if (state === 'gap') return 'Coverage gap';
  if (state === 'stale') return 'Stale';
  if (state === 'not_started') return 'Not started';
  if (state === 'healthy') return 'Healthy';
  if (collector.retention?.retention_risk) return 'Retention risk';
  if (Number(collector.coverage_gaps) > 0) return 'Coverage gap';
  if (Number(collector.pending_dead_letters) > 0) return 'Dead letters pending';
  if (collector.last_run && collector.last_run.status === 'failed') return 'Last run failed';
  return 'Healthy';
}

async function loadCoverage({ render = true } = {}) {
  const coverage = state.coverage;
  coverage.loading = true;
  coverage.error = null;
  if (render) renderCoverage();
  try {
    const [collectors, events, windows] = await Promise.all([
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=collectors`, { cache: 'no-store' }).then(response => response.json()),
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=feed-events&limit=50`, { cache: 'no-store' }).then(response => response.json()),
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=coverage-windows&days=7`, { cache: 'no-store' }).then(response => response.json())
    ]);
    if (collectors.ok === false || events.ok === false || windows.ok === false) throw new Error(collectors.error || events.error || windows.error || 'Coverage data unavailable');
    coverage.collectors = collectors.result?.collectors || [];
    coverage.events = events.result?.events || [];
    coverage.windows = windows.result?.windows || [];
  } catch (error) {
    coverage.error = error?.message || String(error);
  } finally {
    coverage.loading = false;
    if (render) renderCoverage();
  }
}

async function runCoverageAction(action, payload = {}, button = null) {
  const result = await runResearchDiscoveryAction(action, payload, button);
  await loadCoverage({ render: false });
  renderCoverage();
  return result;
}

function renderCoverage() {
  const statsHost = el('coverage-stats');
  const collectorsHost = el('coverage-collectors');
  const eventsHost = el('coverage-events');
  const windowsHost = el('coverage-windows');
  if (!statsHost || !collectorsHost || !eventsHost || !windowsHost) return;
  const coverage = state.coverage;
  if (coverage.loading) {
    statsHost.innerHTML = '';
    collectorsHost.innerHTML = '<div class="empty-state compact">Loading registry coverage…</div>';
    eventsHost.innerHTML = '';
    windowsHost.innerHTML = '';
    return;
  }
  if (coverage.error) {
    statsHost.innerHTML = '';
    collectorsHost.innerHTML = `<div class="error">${escapeHtml(coverage.error)}</div>`;
    eventsHost.innerHTML = '<div class="small">Coverage data is unavailable. Check the local Core helper and refresh.</div>';
    windowsHost.innerHTML = '';
    return;
  }
  const collectors = coverage.collectors || [];
  const totalEvents = collectors.reduce((sum, item) => sum + (Number(item.events_stored) || 0), 0);
  const deadLetters = collectors.reduce((sum, item) => sum + (Number(item.pending_dead_letters) || 0), 0);
  const gaps = collectors.reduce((sum, item) => sum + (Number(item.active_coverage_gaps ?? item.coverage_gaps) || 0), 0);
  const historicalGaps = collectors.reduce((sum, item) => sum + (Number(item.historical_gaps) || 0), 0);
  const paused = collectors.filter(item => !item.enabled).length;
  const risks = collectors.filter(item => item.retention?.retention_risk).length;
  statsHost.innerHTML = [
    edgeMetric('Collectors', collectors.length, paused ? `${paused} paused` : 'Defined global feeds'),
    edgeMetric('Events stored', totalEvents, 'Append-only ledger'),
    edgeMetric('Dead letters', deadLetters, deadLetters ? 'Awaiting retry' : 'Queue clear'),
    edgeMetric('Active coverage gaps', gaps, gaps ? 'Replay required' : 'No missing windows'),
    edgeMetric('Retention risk', risks, risks ? 'Cursor near expiry' : 'Inside retention')
  ].join('');

  collectorsHost.innerHTML = collectors.length ? collectors.map(collector => {
    const lastRun = collector.last_run || {};
    const retention = collector.retention;
    const snapshot = collector.last_snapshot;
    return `
      <div class="coverage-collector">
        <div class="page-header compact-header">
          <div>
            <strong>${escapeHtml(collector.name)}</strong>
            <p class="small" style="margin:4px 0 0;">${escapeHtml(collector.ecosystem)} · ${escapeHtml(collector.mode)} · cursor <code>${escapeHtml(collector.cursor || '—')}</code></p>
          </div>
          <span class="status-pill">${escapeHtml(coverageCollectorHealth(collector))}</span>
        </div>
        <div class="small">
          Lag ${escapeHtml(formatCoverageLag(collector.lag_seconds))} · ${Number(collector.events_stored) || 0} events · ${Number(collector.pending_dead_letters) || 0} dead letters · ${Number(collector.active_coverage_gaps ?? collector.coverage_gaps) || 0} active gaps${Number(collector.historical_gaps) ? ` · ${Number(collector.historical_gaps)} historical` : ''}${retention ? ` · cursor age ${escapeHtml(formatCoverageLag(retention.cursor_age_seconds))} of ${escapeHtml(formatCoverageLag(retention.retention_seconds))}` : ''}${snapshot ? ` · snapshot <code>${escapeHtml(snapshot.serial)}</code> (${Number(snapshot.item_count) || 0} items)` : ''}
        </div>
        <div class="small">Last run: ${escapeHtml(lastRun.status || 'never')}${lastRun.error_message ? ` · ${escapeHtml(lastRun.error_message)}` : ''}${collector.coverage_note ? ` · ${escapeHtml(collector.coverage_note)}` : ''}</div>
        <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
          <button class="mini-btn coverage-run-btn" data-ecosystem="${escapeHtml(collector.ecosystem)}" type="button" ${collector.enabled ? '' : 'disabled'}>Run now</button>
          <button class="mini-btn coverage-toggle-btn" data-ecosystem="${escapeHtml(collector.ecosystem)}" data-enabled="${collector.enabled ? '1' : '0'}" type="button">${collector.enabled ? 'Pause' : 'Resume'}</button>
        </div>
      </div>`;
  }).join('') : '<div class="empty-state compact">No collectors defined yet.</div>';

  eventsHost.innerHTML = coverage.events.length
    ? `<div class="table-wrap"><table><thead><tr><th>Registry time</th><th>Ecosystem</th><th>Package</th><th>Version</th><th>Event</th><th>State</th></tr></thead><tbody>${coverage.events.map(event => `<tr><td>${escapeHtml(event.registry_timestamp || '')}</td><td>${escapeHtml(event.ecosystem)}</td><td><strong>${escapeHtml(event.package)}</strong></td><td>${escapeHtml(event.version || '—')}</td><td>${escapeHtml(statusLabel(event.event_type))}</td><td>${escapeHtml(statusLabel(event.processing_state))}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state compact">No feed events recorded yet. Run a collector to start the ledger.</div>';

  windowsHost.innerHTML = coverage.windows.length
    ? `<div class="small" style="margin-bottom:8px;">${historicalGaps ? `${historicalGaps} historical gap(s) remain retained for audit; only active gaps require replay.` : 'Gap history is retained for audit.'}</div><div class="table-wrap"><table><thead><tr><th>Window start</th><th>Window end</th><th>Pages</th><th>Events</th><th>State</th></tr></thead><tbody>${coverage.windows.map(window => `<tr><td>${escapeHtml(window.window_start || '')}</td><td>${escapeHtml(window.window_end || '')}</td><td>${Number(window.processed_pages) || 0}/${Number(window.expected_pages) || 0}</td><td>${Number(window.events_stored) || 0}</td><td>${escapeHtml(window.is_active === false ? `${statusLabel(window.classification || window.state)} (historical)` : statusLabel(window.state))}${window.gap_reason ? ` · ${escapeHtml(humanizeMachineText(window.gap_reason))}` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state compact">No coverage windows recorded yet.</div>';
}

const researchCaseActionQueues = new Map();

async function runResearchCaseAction(action, payload = {}, button = null) {
  const key = researchActionQueueKey('case', action, payload);
  return enqueueResearchAction(researchCaseActionQueues, key, () => runResearchCaseActionNow(action, payload, button));
}

async function runResearchCaseActionNow(action, payload = {}, button = null) {
  const token = state.researchCases.adminToken || state.triageOps.adminToken;
  if (!token) {
    setStatus('Use the protected research action token before changing a case.', true);
    el('research-cases-admin-token')?.focus();
    return null;
  }
  setButtonBusy(button, true, action === 'draft-blog' ? 'Creating draft…' : 'Working…');
  try {
    const response = await dashboardApiFetch(researchCasesEndpoint(`/${action}`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Triage-Ops-Admin-Token': token
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || result.result?.error || `Research action HTTP ${response.status}`);
    state.researchCases.lastAction = { action, result, at: new Date().toISOString() };
    const nextId = result.result?.case_id || result.case_id || result.result?.case?.case_id || result.case?.case_id || payload.case_id || state.researchCases.selectedId;
    if (nextId) state.researchCases.selectedId = nextId;
    if (action === 'export' && result.artifact) researchDownloadArtifact(result.artifact);
    await loadResearchCases({ render: false, preserveSelection: true });
    const selectedCase = state.researchCases.selected;
    if (action === 'update' && selectedCase) {
      const checks = [
        ['status', payload.status],
        ['disclosure_status', payload.disclosure_status],
        ['severity', payload.severity],
        ['owner', payload.owner],
        ['summary', payload.summary],
      ].filter(([, expected]) => expected !== undefined && expected !== null && String(expected) !== '');
      const mismatches = checks.filter(([field, expected]) => String(selectedCase[field] ?? '') !== String(expected));
      const expectedConfidence = payload.confidence;
      if (expectedConfidence !== undefined && expectedConfidence !== null && String(expectedConfidence) !== '' && Number(selectedCase.confidence) !== Number(expectedConfidence)) {
        mismatches.push(['confidence', expectedConfidence]);
      }
      if (mismatches.length) {
        throw new Error(`Core did not persist ${mismatches.map(([field]) => field).join(', ')}`);
      }
    }
    if (action === 'verdict' && selectedCase && payload.verdict) {
      const latestVerdict = Array.isArray(selectedCase.verdicts) ? selectedCase.verdicts[0] : null;
      if (!latestVerdict || String(latestVerdict.verdict) !== String(payload.verdict) || Number(latestVerdict.confidence) !== Number(payload.confidence)) {
        throw new Error('Core did not confirm the recorded verdict after reload');
      }
    }
    renderResearchCases();
    setStatus(`<span class="dot"></span> ${escapeHtml(statusLabel(action))} completed for ${escapeHtml(nextId || 'research case')}`);
    await refreshAfterAction({ key: `research-case:${action}:${nextId || 'workspace'}` });
    return result;
  } catch (error) {
    state.researchCases.lastAction = { action, error: error?.message || String(error), at: new Date().toISOString() };
    setStatus(`Research action failed: ${error?.message || String(error)}`, true);
    renderResearchCases();
    return null;
  } finally {
    setButtonBusy(button, false);
  }
}

async function runArtifactCaseAction(action, payload = {}, button = null) {
  const token = state.researchCases.adminToken || state.triageOps.adminToken;
  if (!token) { setStatus('Use the protected research action token first.', true); return null; }
  setButtonBusy(button, true, 'Working…');
  try {
    const endpoint = action === 'extract' ? '/api/secopsai/research-artifacts/ioc-candidates' : '/api/secopsai/research-artifacts/analysis';
    const requestedAction = action === 'analysis' && payload.queue ? 'queue' : (action === 'analysis' ? (payload.action || 'run') : 'extract');
    const response = await dashboardApiFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Triage-Ops-Admin-Token': token }, body: JSON.stringify({ action: requestedAction, ...payload }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || result.cli?.stderr || 'Artifact action failed');
    await loadResearchCaseDetail(state.researchCases.selectedId, { render: false });
    renderResearchCases();
    setStatus(`<span class="dot"></span> ${action === 'extract' ? 'IOC candidates extracted' : 'Artifact inspection completed'}`);
    await refreshAfterAction({ key: `research-artifact:${action}:${payload.artifact_id || state.researchCases.selectedId || 'workspace'}` });
    return result;
  } catch (error) { setStatus(`Artifact action failed: ${error?.message || error}`, true); return null; }
  finally { setButtonBusy(button, false); }
}

async function downloadApprovedSandboxArtifact(requestId, button = null) {
  const token = state.researchCases.adminToken || state.triageOps.adminToken;
  if (!token) {
    setStatus('Use the protected research action token before preparing a sandbox sample.', true);
    return;
  }
  if (!(await requestConfirmation('Prepare this exact artifact for manual Tria.ge upload?', {
    title: 'Prepare public sandbox sample',
    context: 'The local helper will verify the approved SHA-256 and download one owner-authorized copy to your browser. Nothing is uploaded automatically. Tria.ge public submissions are visible publicly and cannot be deleted by public-cloud users.',
    confirmLabel: 'Prepare sample'
  }))) return;
  setButtonBusy(button, true, 'Preparing…');
  try {
    const response = await dashboardApiFetch('/api/secopsai/research-artifacts/manual-sandbox-download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Triage-Ops-Admin-Token': token
      },
      body: JSON.stringify({ request_id: requestId, public_submission_acknowledged: true })
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(failure.error || `Manual sandbox handoff HTTP ${response.status}`);
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || `secopsai-${requestId.toLowerCase()}-sample.bin`;
    const digest = response.headers.get('X-SecOpsAI-Artifact-SHA256') || '';
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    await loadResearchCaseDetail(state.researchCases.selectedId, { render: false });
    renderResearchCases();
    setStatus(`<span class="dot"></span> Hash-verified sample prepared${digest ? ` · SHA-256 ${escapeHtml(digest)}` : ''}`);
  } catch (error) {
    setStatus(`Manual sandbox handoff failed: ${error?.message || error}`, true);
  } finally {
    setButtonBusy(button, false);
  }
}

async function runResearchWatchlistAction(action, payload = {}, button = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (action === 'create') {
    const token = state.researchCases.adminToken || state.triageOps.adminToken;
    if (!token) {
      setStatus('Use the protected research action token before creating draft cases.', true);
      el('research-cases-admin-token')?.focus();
      return null;
    }
    headers['X-Triage-Ops-Admin-Token'] = token;
  }
  setButtonBusy(button, true, action === 'create' ? 'Creating…' : 'Previewing…');
  try {
    const response = await dashboardApiFetch(cfg.researchWatchlistEndpoint || '/api/secopsai/research-watchlist', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, ecosystem: 'npm', ...payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || result.result?.error || `Research watchlist HTTP ${response.status}`);
    setStatus(`<span class="dot"></span> ${action === 'create' ? 'Draft cases created' : 'Watchlist preview ready'}`);
    await refreshAfterAction({ key: `research-watchlist:${action}` });
    return result;
  } catch (error) {
    setStatus(`Research watchlist action failed: ${error?.message || String(error)}`, true);
    return null;
  } finally {
    setButtonBusy(button, false);
  }
}

function researchDetailSection(title, body) {
  return `<section class="research-detail-section"><h4>${escapeHtml(title)}</h4>${body}</section>`;
}

function researchTable(headers, rows, emptyMessage) {
  if (!rows.length) return `<div class="empty-state compact">${escapeHtml(emptyMessage)}</div>`;
  return `<div class="table-wrap research-table"><table><thead><tr>${headers.map(item => `<th>${escapeHtml(item)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function researchRetractControl(itemType, item) {
  if (item.status === 'retracted') return renderStatusPill('closed', 'Retracted');
  const id = item[`${itemType}_id`] || item.subject_id || item.evidence_id || item.ioc_id;
  return `<button class="mini-btn research-retract-btn" type="button" data-item-type="${escapeHtml(itemType)}" data-item-id="${escapeHtml(id || '')}">Retract</button>`;
}

function openResearchRetractModal(researchCase, itemType, itemId) {
  state.researchCases.retractTarget = { caseId: researchCase.case_id, itemType, itemId };
  const context = el('research-retract-context');
  if (context) context.textContent = `${itemType} ${itemId} will remain in ${researchCase.case_id} but will be excluded from active evidence and publication.`;
  if (el('research-retract-reason')) el('research-retract-reason').value = '';
  el('research-retract-modal')?.classList.remove('hidden');
  setTimeout(() => el('research-retract-reason')?.focus(), 0);
}

function closeResearchRetractModal() {
  state.researchCases.retractTarget = null;
  el('research-retract-modal')?.classList.add('hidden');
}

async function loadContentPacks() {
  const host = el('research-content-packs-list');
  if (!host) return;
  host.innerHTML = '<div class="empty-state">Loading social content packs…</div>';
  try {
    const response = await dashboardApiFetch('/api/secopsai/content-packs');
    const data = await response.json().catch(() => ({}));
    const packs = data.content_packs || [];
    renderContentPacks(packs);
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load content packs: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}

function renderContentPacks(packs) {
  const host = el('research-content-packs-list');
  if (!host) return;
  if (!packs || !packs.length) {
    host.innerHTML = '<div class="empty-state">No content packs generated yet. Enter a Case ID above or click "📦 Generate Social Pack" on any active research case.</div>';
    return;
  }
  host.innerHTML = packs.map(pack => `
    <div class="card" style="margin-bottom:12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
        <div>
          <strong style="color:var(--text-strong, #fff); font-size:14px;">${escapeHtml(pack.pack_id)}</strong>
          <span class="small" style="margin-left:8px; color:var(--text-muted, #aaa);">${escapeHtml(pack.package)}@${escapeHtml(pack.version || '')} (${escapeHtml(pack.ecosystem || 'npm')})</span>
          ${renderSeverityPill(pack.severity || 'high')}
        </div>
        <span class="small" style="color:var(--text-muted, #888);">${escapeHtml(fmtDate(pack.created_at))}</span>
      </div>
      <div class="research-form-actions" style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="mini-btn secondary-btn cpk-fetch-btn" data-type="twitter_thread" data-pack-id="${escapeHtml(pack.pack_id)}" data-case-id="${escapeHtml(pack.case_id)}" type="button">🧵 Copy X / Twitter Thread</button>
        <button class="mini-btn secondary-btn cpk-fetch-btn" data-type="reddit_post" data-pack-id="${escapeHtml(pack.pack_id)}" data-case-id="${escapeHtml(pack.case_id)}" type="button">🛡️ Copy Reddit Post (r/netsec)</button>
        <button class="mini-btn secondary-btn cpk-fetch-btn" data-type="linkedin_post" data-pack-id="${escapeHtml(pack.pack_id)}" data-case-id="${escapeHtml(pack.case_id)}" type="button">💼 Copy LinkedIn Post</button>
        <span class="small" style="align-self:center; margin-left:auto; color:var(--text-muted, #888);">Assets: ${(pack.files?.assets || []).length} files packaged</span>
      </div>
      <div class="cpk-preview-box" id="cpk-preview-${escapeHtml(pack.pack_id)}" style="display:none; margin-top:12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span class="small" style="color:var(--accent-color, #4ade80); font-weight:600;" id="cpk-preview-label-${escapeHtml(pack.pack_id)}">Copied Content</span>
          <button class="mini-btn cpk-copy-again-btn" data-pack-id="${escapeHtml(pack.pack_id)}" type="button">📋 Copy Text Again</button>
        </div>
        <textarea readonly style="width:100%; height:180px; font-family:monospace; font-size:12px; line-height:1.4; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:4px; padding:8px; color:var(--text-color, #eee);" id="cpk-preview-text-${escapeHtml(pack.pack_id)}"></textarea>
      </div>
    </div>
  `).join('');

  host.querySelectorAll('.cpk-fetch-btn').forEach(button => {
    button.addEventListener('click', async event => {
      const type = button.dataset.type;
      const caseId = button.dataset.caseId;
      const packId = button.dataset.packId;
      const labelMap = {
        twitter_thread: 'X / Twitter Thread',
        reddit_post: 'Reddit (r/netsec) Post',
        linkedin_post: 'LinkedIn Post'
      };
      const label = labelMap[type] || type;
      setButtonBusy(button, true, 'Copying…');
      try {
        let pack = packs.find(p => p.pack_id === packId);
        let textContent = pack?.content?.[type];
        if (!textContent) {
          const res = await dashboardApiFetch('/api/secopsai/content-packs/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ case_id: caseId })
          });
          const resData = await res.json().catch(() => ({}));
          if (!res.ok || resData.ok === false) throw new Error(resData.error || 'Failed to fetch content');
          pack = resData.pack;
          textContent = pack?.content?.[type] || '';
        }
        if (textContent) {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(textContent);
          }
          const previewBox = el(`cpk-preview-${packId}`);
          const previewText = el(`cpk-preview-text-${packId}`);
          const previewLabel = el(`cpk-preview-label-${packId}`);
          if (previewBox && previewText) {
            previewBox.style.display = 'block';
            previewText.value = textContent;
            if (previewLabel) previewLabel.textContent = `✅ ${label} Copied to Clipboard!`;
            previewText.focus();
            previewText.select();
          }
          setStatus(`<span class="dot"></span> ✅ ${label} copied to clipboard! (Ready to paste directly into ${type.startsWith('twitter') ? 'X/Twitter' : type.startsWith('reddit') ? 'Reddit' : 'LinkedIn'})`);
        } else {
          setStatus(`Content pack ready: ${packId}`);
        }
      } catch (e) {
        setStatus(`Content copy error: ${e?.message || e}`, true);
      } finally {
        setButtonBusy(button, false);
      }
    });
  });

  host.querySelectorAll('.cpk-copy-again-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const packId = btn.dataset.packId;
      const previewText = el(`cpk-preview-text-${packId}`);
      if (previewText && previewText.value) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(previewText.value);
        }
        setStatus('<span class="dot"></span> Copied text to clipboard again!');
      }
    });
  });
}

async function generateContentPackForCase(caseId, btn) {
  if (!caseId) { setStatus('Enter or select a Case ID first.', true); return; }
  setButtonBusy(btn, true, 'Generating Pack…');
  try {
    const response = await dashboardApiFetch('/api/secopsai/content-packs/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_id: caseId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Content pack generation failed');
    setStatus(`<span class="dot"></span> Social & Community Content Pack generated for ${escapeHtml(caseId)}!`);
    const panel = el('research-content-packs-panel');
    if (panel) panel.open = true;
    await loadContentPacks();
  } catch (err) {
    setStatus(`Content pack generation failed: ${err?.message || err}`, true);
  } finally {
    setButtonBusy(btn, false);
  }
}

function bindResearchCaseDetailActions(researchCase) {
  bindReliabilityCaseActions(researchCase);
  el('research-reconcile-btn')?.addEventListener('click', async event => {
    if (!(await requestConfirmation('Reclassify legacy URL candidates for this case?', {
      title: 'Reconcile evidence provenance',
      context: 'Source, documentation, and shared-service URLs will be marked as rejected references with reasons. Existing rows and the audit trail are preserved.',
      confirmLabel: 'Reconcile indicators'
    }))) return;
    runResearchCaseAction('reconcile', { case_id: researchCase.case_id, actor: 'dashboard-operator' }, event.currentTarget);
  });
  el('research-artifact-import-btn')?.addEventListener('click', async event => {
    const file = el('research-artifact-file')?.files?.[0];
    const token = state.researchCases.adminToken || state.triageOps.adminToken;
    if (!file) { setStatus('Choose an authorized package file first.', true); return; }
    if (!token) { setStatus('Use the protected research action token before importing an artifact.', true); return; }
    const source = el('research-artifact-source')?.value?.trim() || '';
    if (!source) { setStatus('Describe the lawful source and authorization for this artifact first.', true); return; }
    setButtonBusy(event.currentTarget, true, 'Quarantining…');
    try {
      const response = await dashboardApiFetch('/api/secopsai/research-artifacts/import', { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream', 'X-Triage-Ops-Admin-Token': token, 'X-Artifact-Ecosystem': el('research-artifact-ecosystem')?.value || 'nuget', 'X-Artifact-Package': el('research-artifact-package')?.value || '', 'X-Artifact-Version': el('research-artifact-version')?.value || '', 'X-Artifact-Source': source } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.error || result.cli?.stderr || 'Artifact import failed');
      if (result.artifact?.artifact_id) {
        const attachResponse = await dashboardApiFetch('/api/secopsai/research-artifacts/attach', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Triage-Ops-Admin-Token': token }, body: JSON.stringify({ case_id: researchCase.case_id, artifact_id: result.artifact.artifact_id, role: 'subject' }) });
        const attachResult = await attachResponse.json().catch(() => ({}));
        if (!attachResponse.ok || attachResult.ok === false) throw new Error(attachResult.error || 'Artifact attachment failed');
      }
      await runResearchCaseAction('add-evidence', { case_id: researchCase.case_id, evidence_type: 'package_artifact', title: `Authorized artifact ${result.artifact?.artifact_id || ''}`, sha256: result.artifact?.sha256 || '', provenance: 'Mission Control local quarantine', notes: 'Raw bytes retained only in local Core quarantine.', actor: 'dashboard-operator' });
      if (result.artifact?.artifact_id) await runArtifactCaseAction('analysis', { artifact_id: result.artifact.artifact_id, case_id: researchCase.case_id, queue: true });
      setStatus('<span class="dot"></span> Artifact quarantined and inspected locally');
    } catch (error) { setStatus(`Artifact import failed: ${error?.message || error}`, true); }
    finally { setButtonBusy(event.currentTarget, false); }
  });
  el('research-artifact-ioc-btn')?.addEventListener('click', event => runArtifactCaseAction('extract', { case_id: researchCase.case_id }, event.currentTarget));
  el('research-artifact-compare-btn')?.addEventListener('click', event => runArtifactCaseAction('analysis', { action: 'compare', left_artifact_id: el('research-artifact-left')?.value, right_artifact_id: el('research-artifact-right')?.value }, event.currentTarget));
  document.querySelectorAll('#research-case-detail .research-artifact-analysis-btn').forEach(button => button.addEventListener('click', event => runArtifactCaseAction('analysis', { artifact_id: button.dataset.artifactId }, event.currentTarget)));
  document.querySelectorAll('#research-case-detail .research-subject-state-btn').forEach(button => button.addEventListener('click', async event => {
    const token = state.researchCases.adminToken || state.triageOps.adminToken;
    if (!token) { setStatus('Use the protected research action token first.', true); return; }
    const subjectId = button.dataset.subjectId;
    const response = await dashboardApiFetch('/api/secopsai/research-subjects/state', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Triage-Ops-Admin-Token': token }, body: JSON.stringify({ subject_id: subjectId, registry_state: el(`research-subject-registry-${subjectId}`)?.value, artifact_state: el(`research-subject-artifact-${subjectId}`)?.value, validation_state: el(`research-subject-validation-${subjectId}`)?.value, reason: el(`research-subject-reason-${subjectId}`)?.value || '' }) });
    if (!response.ok) { const payload = await response.json().catch(() => ({})); setStatus(`Subject state update failed: ${payload.error || response.status}`, true); return; }
    await loadResearchCaseDetail(researchCase.case_id, { render: false }); renderResearchCases(); setStatus('<span class="dot"></span> Subject lifecycle state updated');
  }));
  el('research-pipeline-start-btn')?.addEventListener('click', async event => {
    if (!(await requestConfirmation(`Run the safe investigation pipeline for ${researchCase.case_id}?`, {
      title: 'Run investigation pipeline',
      context: 'SecOpsAI will collect registry artifacts without executing them, queue minimized Local Codex analysis, and stop at human review.',
      confirmLabel: 'Run pipeline'
    }))) return;
    runResearchCaseAction('pipeline-start', {
      case_id: researchCase.case_id,
      reference_ecosystem: el('research-pipeline-reference-ecosystem')?.value,
      reference_package: el('research-pipeline-reference-package')?.value,
      reference_version: el('research-pipeline-reference-version')?.value,
      actor: 'dashboard-operator'
    }, event.currentTarget);
  });
  el('research-pipeline-resume-btn')?.addEventListener('click', event => {
    const pipeline = (researchCase.pipelines || [])[0];
    if (!pipeline) return;
    runResearchCaseAction('pipeline-resume', {
      pipeline_id: pipeline.pipeline_id,
      reference_ecosystem: el('research-pipeline-reference-ecosystem')?.value,
      reference_package: el('research-pipeline-reference-package')?.value,
      reference_version: el('research-pipeline-reference-version')?.value,
      actor: 'dashboard-operator'
    }, event.currentTarget);
  });
  el('research-pipeline-open-automation-btn')?.addEventListener('click', () => setPage('automation'));
  el('research-pipeline-refresh-btn')?.addEventListener('click', event => runRefreshAction(
    event.currentTarget,
    async () => {
      await loadResearchCaseDetail(researchCase.case_id, { render: false });
      renderResearchCases();
    },
    { successMessage: 'Research pipeline status refreshed', errorMessage: 'Research pipeline refresh failed' },
  ));
  document.querySelectorAll('#research-case-detail .research-pipeline-review-btn').forEach(button => button.addEventListener('click', async event => {
    const decision = button.dataset.decision;
    const itemId = button.dataset.itemId;
    const pipelineId = button.dataset.pipelineId;
    const editedContent = el(`research-review-content-${itemId}`)?.value || '';
    if (!(await requestConfirmation(`${decision === 'accepted' ? 'Accept' : 'Reject'} this proposed ${statusLabel(button.dataset.itemType || 'research item')}?`, {
      title: `${decision === 'accepted' ? 'Accept' : 'Reject'} research proposal`,
      context: decision === 'accepted'
        ? 'Accepted evidence proposals are attached to the case. Accepted model text becomes an immutable analyst-reviewed case note.'
        : 'Rejected proposals remain auditable and do not change the research case.',
      confirmLabel: decision === 'accepted' ? 'Accept proposal' : 'Reject proposal',
      danger: decision === 'rejected'
    }))) return;
    runResearchCaseAction('pipeline-review', {
      pipeline_id: pipelineId,
      item_id: itemId,
      decision,
      edited_content: editedContent,
      review_note: `Reviewed in Mission Control as ${decision}.`,
      actor: 'dashboard-operator'
    }, event.currentTarget);
  }));
  el('research-pipeline-auto-review-btn')?.addEventListener('click', async event => {
    const pipelineId = event.currentTarget.dataset.pipelineId;
    if (!(await requestConfirmation('Complete the guarded agent review for this investigation?', {
      title: 'Complete Agent Review',
      context: 'SecOpsAI will accept bounded pipeline evidence, record an evidence-linked agent verdict, and rerun publication safety. It will not execute the package, submit it to a sandbox, send disclosure, or publish content.',
      confirmLabel: 'Complete Agent Review'
    }))) return;
    runResearchCaseAction('pipeline-auto-review', {
      pipeline_id: pipelineId,
      actor: 'secopsai-agent-autonomy'
    }, event.currentTarget);
  });
  el('research-save-case-btn')?.addEventListener('click', async event => {
    await runResearchCaseAction('update', {
    case_id: researchCase.case_id,
    status: el('research-detail-status')?.value,
    disclosure_status: el('research-detail-disclosure')?.value,
    confidence: el('research-detail-confidence')?.value,
    severity: el('research-detail-severity')?.value,
    potential_impact: el('research-detail-impact')?.value,
    owner: el('research-detail-owner')?.value,
    summary: el('research-detail-summary')?.value,
    actor: 'dashboard-operator'
    }, event.currentTarget);
  });
  el('research-add-subject-btn')?.addEventListener('click', event => runResearchCaseAction('add-subject', {
    case_id: researchCase.case_id,
    subject_type: el('research-subject-type')?.value,
    ecosystem: el('research-subject-ecosystem')?.value,
    name: el('research-subject-name')?.value,
    version: el('research-subject-version')?.value,
    publisher: el('research-subject-publisher')?.value,
    actor: 'dashboard-operator'
  }, event.currentTarget));
  el('research-add-evidence-btn')?.addEventListener('click', event => runResearchCaseAction('add-evidence', {
    case_id: researchCase.case_id,
    evidence_type: el('research-evidence-type')?.value,
    title: el('research-evidence-title')?.value,
    locator: el('research-evidence-locator')?.value,
    sha256: el('research-evidence-sha256')?.value,
    provenance: el('research-evidence-provenance')?.value,
    notes: el('research-evidence-notes')?.value,
    visual_viewport: el('research-evidence-visual-viewport')?.value,
    alt_text: el('research-evidence-alt-text')?.value,
    image_license: el('research-evidence-license')?.value,
    source_attribution: el('research-evidence-source-attribution')?.value,
    actor: 'dashboard-operator'
  }, event.currentTarget));
  el('research-add-ioc-btn')?.addEventListener('click', event => runResearchCaseAction('add-ioc', {
    case_id: researchCase.case_id,
    ioc_type: el('research-ioc-type')?.value,
    value: el('research-ioc-value')?.value,
    confidence: el('research-ioc-confidence')?.value,
    source_evidence_id: el('research-ioc-evidence')?.value,
    tags: (el('research-ioc-tags')?.value || '').split(',').map(item => item.trim()).filter(Boolean),
    actor: 'dashboard-operator'
  }, event.currentTarget));
  el('research-rule-propose-btn')?.addEventListener('click', event => runResearchCaseAction('rule-propose', {
    case_id: researchCase.case_id,
    actor: 'dashboard-operator'
  }, event.currentTarget));
  document.querySelectorAll('.research-rule-review-btn').forEach(button => button.addEventListener('click', async event => {
    const decision = button.dataset.decision;
    if (decision === 'accepted' && !(await requestConfirmation(
      `Activate ${button.dataset.proposalId}? The validated rule will become an active case-linked detection.`,
      {
        title: 'Activate detection rule',
        context: 'The rule remains linked to its source evidence and can be retracted from the case history.',
        confirmLabel: 'Activate rule'
      }
    ))) return;
    runResearchCaseAction('rule-review', {
      case_id: researchCase.case_id,
      proposal_id: button.dataset.proposalId,
      decision,
      actor: 'dashboard-operator'
    }, event.currentTarget);
  }));
  el('research-add-rule-btn')?.addEventListener('click', event => runResearchCaseAction('add-rule', {
    case_id: researchCase.case_id,
    rule_type: el('research-rule-type')?.value,
    name: el('research-rule-name')?.value,
    purpose: el('research-rule-purpose')?.value,
    content: el('research-rule-content')?.value,
    source_evidence_id: el('research-rule-evidence')?.value,
    actor: 'dashboard-operator'
  }, event.currentTarget));
  el('research-link-finding-btn')?.addEventListener('click', event => runResearchCaseAction('link-finding', {
    case_id: researchCase.case_id,
    finding_id: el('research-link-finding-id')?.value,
    relationship: el('research-link-relationship')?.value,
    actor: 'dashboard-operator'
  }, event.currentTarget));
  el('research-add-note-btn')?.addEventListener('click', event => runResearchCaseAction('note', {
    case_id: researchCase.case_id,
    note: el('research-note-text')?.value,
    actor: 'dashboard-operator'
  }, event.currentTarget));
  el('research-export-btn')?.addEventListener('click', event => runResearchCaseAction('export', { case_id: researchCase.case_id }, event.currentTarget));
  el('research-draft-blog-btn')?.addEventListener('click', async event => {
    if (!(await requestConfirmation(`Create a review-only blog draft for ${researchCase.case_id}? This does not publish it.`, {
      title: 'Create publication draft',
      context: 'The draft remains in review and cannot publish without a separate approval.',
      confirmLabel: 'Create draft'
    }))) return;
    runResearchCaseAction('draft-blog', { case_id: researchCase.case_id }, event.currentTarget);
  });
  el('research-case-gen-pack-btn')?.addEventListener('click', async event => {
    await generateContentPackForCase(researchCase.case_id, event.currentTarget);
  });
  el('research-intake-preview-btn')?.addEventListener('click', event => runResearchCaseAction('intake-preview', {
    case_id: researchCase.case_id,
    ecosystem: el('research-intake-ecosystem')?.value,
    package: el('research-intake-package')?.value,
    version: el('research-intake-version')?.value
  }, event.currentTarget));
  el('research-intake-run-btn')?.addEventListener('click', event => runResearchCaseAction('intake-run', {
    case_id: researchCase.case_id,
    ecosystem: el('research-intake-ecosystem')?.value,
    package: el('research-intake-package')?.value,
    version: el('research-intake-version')?.value,
    attach: el('research-intake-attach')?.value === 'true',
    actor: 'dashboard-operator'
  }, event.currentTarget));
  el('research-compare-packages-btn')?.addEventListener('click', event => runResearchDiscoveryAction('compare-packages', {
    left_ecosystem: el('research-compare-left-ecosystem')?.value,
    left_package: el('research-compare-left-package')?.value,
    left_version: el('research-compare-left-version')?.value,
    right_ecosystem: el('research-compare-right-ecosystem')?.value,
    right_package: el('research-compare-right-package')?.value,
    right_version: el('research-compare-right-version')?.value
  }, event.currentTarget));
  el('research-matrix-btn')?.addEventListener('click', event => runResearchCaseAction('evidence-matrix', { case_id: researchCase.case_id, actor: 'dashboard-operator' }, event.currentTarget));
  el('research-brief-btn')?.addEventListener('click', event => runResearchCaseAction('analyst-brief', { case_id: researchCase.case_id, actor: 'dashboard-operator' }, event.currentTarget));
  el('research-publication-check-btn')?.addEventListener('click', event => runResearchCaseAction('publication-check', { case_id: researchCase.case_id, actor: 'dashboard-operator' }, event.currentTarget));
  el('research-verdict-btn')?.addEventListener('click', event => runResearchCaseAction('verdict', {
    case_id: researchCase.case_id,
    verdict: el('research-verdict-value')?.value,
    confidence: el('research-verdict-confidence')?.value,
    rationale: el('research-verdict-rationale')?.value,
    evidence_ids: (el('research-verdict-evidence')?.value || '').split(',').map(item => item.trim()).filter(Boolean),
    actor: 'dashboard-operator'
  }, event.currentTarget));
  el('research-publication-approve-btn')?.addEventListener('click', async event => {
    const review = (researchCase.publication_reviews || [])[0];
    if (!review || !(await requestConfirmation('Record final human approval for this publication safety review?', {
      title: 'Approve publication safety review',
      context: 'This records the final human approval gate. It does not deploy the article by itself.',
      confirmLabel: 'Record approval'
    }))) return;
    await runResearchCaseAction('publication-approve', { case_id: researchCase.case_id, review_id: review.review_id, waivers: [], actor: 'dashboard-publisher' }, event.currentTarget);
  });
  el('research-disclosure-suggest-btn')?.addEventListener('click', async event => {
    const result = await runResearchCaseAction('suggest-disclosure', {
      case_id: researchCase.case_id,
      actor: 'dashboard-operator'
    }, event.currentTarget);
    const suggestion = result?.result || result || {};
    if (!suggestion || (!suggestion.recipient && !suggestion.subject && !suggestion.body)) return;
    // Preserve operator edits only when the server returned a value.
    if (el('research-disclosure-recipient') && suggestion.recipient) el('research-disclosure-recipient').value = suggestion.recipient;
    if (el('research-disclosure-subject') && suggestion.subject) el('research-disclosure-subject').value = suggestion.subject;
    if (el('research-disclosure-body') && suggestion.body) el('research-disclosure-body').value = suggestion.body;
    if (Array.isArray(suggestion.recipient_candidates) && el('research-disclosure-recipient-options')) {
      el('research-disclosure-recipient-options').innerHTML = suggestion.recipient_candidates
        .map(value => `<option value="${escapeHtml(value)}"></option>`)
        .join('');
    }
  });
  el('research-disclosure-btn')?.addEventListener('click', async event => {
    await runResearchCaseAction('prepare-disclosure', {
    case_id: researchCase.case_id,
    recipient: el('research-disclosure-recipient')?.value,
    subject: el('research-disclosure-subject')?.value,
    body: el('research-disclosure-body')?.value,
    actor: 'dashboard-operator'
    }, event.currentTarget);
  });
  el('research-partner-request-btn')?.addEventListener('click', async event => {
    const token = state.researchCases.adminToken || state.triageOps.adminToken;
    if (!token) { setStatus('Use the protected research action token first.', true); return; }
    setButtonBusy(event.currentTarget, true, 'Creating…');
    try {
      const response = await dashboardApiFetch('/api/secopsai/research-partner-requests', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Triage-Ops-Admin-Token': token }, body: JSON.stringify({ action: 'create', case_id: researchCase.case_id, recipient: el('research-partner-recipient')?.value, reason: el('research-partner-reason')?.value }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.error || 'Partner request failed');
      await loadResearchCaseDetail(researchCase.case_id, { render: false }); renderResearchCases(); setStatus('<span class="dot"></span> Partner request draft created');
    } catch (error) { setStatus(`Partner request failed: ${error?.message || error}`, true); }
    finally { setButtonBusy(event.currentTarget, false); }
  });
  el('research-sandbox-btn')?.addEventListener('click', event => runResearchCaseAction('sandbox-request', {
    case_id: researchCase.case_id,
    artifact_sha256: el('research-sandbox-sha256')?.value,
    justification: el('research-sandbox-justification')?.value,
    behaviors: Array.isArray(researchCase.sandbox_recommendation?.requested_behaviors) && researchCase.sandbox_recommendation.requested_behaviors.length
      ? researchCase.sandbox_recommendation.requested_behaviors
      : ['network behavior', 'filesystem behavior', 'process behavior'],
    provider: state.integrationStatus?.sandbox?.configured ? 'tria.ge' : 'manual-result-import',
    actor: 'dashboard-operator'
  }, event.currentTarget));
  el('research-sandbox-open-request-btn')?.addEventListener('click', () => {
    const drawer = el('research-sandbox-request-drawer');
    if (drawer) drawer.open = true;
    el('research-sandbox-sha256')?.focus();
  });
  document.querySelectorAll('#research-case-detail .research-intake-attach-btn').forEach(button => button.addEventListener('click', event => runResearchCaseAction('intake-attach', { case_id: researchCase.case_id, job_id: button.dataset.jobId, actor: 'dashboard-operator' }, event.currentTarget)));
  document.querySelectorAll('#research-case-detail .research-job-retry-btn').forEach(button => button.addEventListener('click', event => runResearchCaseAction('job-retry', { case_id: researchCase.case_id, job_id: button.dataset.jobId, actor: 'dashboard-operator' }, event.currentTarget)));
  document.querySelectorAll('#research-case-detail .research-job-cancel-btn').forEach(button => button.addEventListener('click', async event => {
    if (!(await requestConfirmation('Cancel this research job?', {
      title: 'Cancel research job',
      context: 'The cancellation will be recorded and the job will not continue.',
      confirmLabel: 'Cancel job',
      danger: true
    }))) return;
    await runResearchCaseAction('job-cancel', { case_id: researchCase.case_id, job_id: button.dataset.jobId, actor: 'dashboard-operator' }, event.currentTarget);
  }));
  document.querySelectorAll('#research-case-detail .research-disclosure-status-btn').forEach(button => button.addEventListener('click', async event => {
    const status = button.dataset.disclosureStatus;
    if (status === 'sent' && !(await requestConfirmation('Record that this disclosure was sent externally?', {
      title: 'Record external disclosure',
      context: 'Only continue after the message has been reviewed and sent through the approved channel.',
      confirmLabel: 'Record as sent'
    }))) return;
    await runResearchCaseAction('disclosure-status', { case_id: researchCase.case_id, disclosure_id: button.dataset.disclosureId, status, actor: 'dashboard-operator' }, event.currentTarget);
  }));
  document.querySelectorAll('#research-case-detail .research-sandbox-status-btn').forEach(button => button.addEventListener('click', async event => {
    if (!(await requestConfirmation('Approve this sandbox request for a public handoff?', {
      title: 'Approve sandbox request',
      context: 'Approval enables a later hash-verified Tria.ge submission. It does not upload or execute the artifact by itself. Tria.ge public submissions are visible publicly and cannot be deleted by public-cloud users.',
      confirmLabel: 'Approve request'
    }))) return;
    const action = button.dataset.sandboxAction || 'sandbox-status';
    await runResearchCaseAction(action, { case_id: researchCase.case_id, request_id: button.dataset.requestId, status: button.dataset.sandboxStatus, public_submission_acknowledged: true, actor: 'dashboard-operator' }, event.currentTarget);
  }));
  document.querySelectorAll('#research-case-detail .research-sandbox-submit-btn').forEach(button => button.addEventListener('click', async event => {
    if (!(await requestConfirmation('Submit this exact artifact to Tria.ge through the server-side API token?', {
      title: 'Submit sandbox sample',
      context: 'The local helper verifies the approved SHA-256 before upload. Tria.ge public submissions are visible publicly and cannot be deleted by public-cloud users.',
      confirmLabel: 'Submit sample'
    }))) return;
    await runResearchCaseAction('sandbox-submit', {
      case_id: researchCase.case_id,
      request_id: button.dataset.requestId,
      public_submission_acknowledged: true
    }, event.currentTarget);
  }));
  document.querySelectorAll('#research-case-detail .research-sandbox-poll-btn').forEach(button => button.addEventListener('click', event => {
    runResearchCaseAction('sandbox-poll', {
      case_id: researchCase.case_id,
      request_id: button.dataset.requestId
    }, event.currentTarget);
  }));
  document.querySelectorAll('#research-case-detail .research-sandbox-reconcile-btn').forEach(button => button.addEventListener('click', async event => {
    if (!(await requestConfirmation('Repair the link for this completed sandbox result?', {
      title: 'Repair sandbox evidence link',
      context: 'SecOpsAI will inspect only the stored, sanitized terminal result and idempotently create the linked sandbox_analysis evidence record when its report URL, submission ID, and artifact hash are valid. It will not contact Tria.ge or execute the artifact.',
      confirmLabel: 'Repair link'
    }))) return;
    runResearchCaseAction('sandbox-reconcile', { case_id: researchCase.case_id, actor: 'dashboard-operator' }, event.currentTarget);
  }));
  document.querySelectorAll('#research-case-detail .research-sandbox-download-btn').forEach(button => button.addEventListener('click', event => {
    downloadApprovedSandboxArtifact(button.dataset.requestId, event.currentTarget);
  }));
  document.querySelectorAll('#research-case-detail .research-sandbox-result-btn').forEach(button => button.addEventListener('click', async event => {
    const requestId = button.dataset.requestId;
    const reportUrl = el(`research-sandbox-result-url-${requestId}`)?.value?.trim() || '';
    const status = el(`research-sandbox-result-status-${requestId}`)?.value || 'completed';
    const summary = el(`research-sandbox-result-summary-${requestId}`)?.value?.trim() || '';
    const scoreText = el(`research-sandbox-result-score-${requestId}`)?.value?.trim() || '';
    let submissionId = '';
    if (reportUrl) {
      try {
        const parsed = new URL(reportUrl);
        if (parsed.protocol !== 'https:' || !['tria.ge', 'www.tria.ge'].includes(parsed.hostname.toLowerCase())) throw new Error('not an approved Tria.ge URL');
        submissionId = parsed.pathname.split('/').filter(Boolean)[0] || '';
      } catch (error) {
        setStatus(`Sandbox result URL is invalid: ${error?.message || error}`, true);
        return;
      }
    }
    if (status === 'completed' && (!reportUrl || !submissionId || !summary)) {
      setStatus('A completed manual result requires the public Tria.ge report URL and a reviewed behavior summary.', true);
      return;
    }
    if (!(await requestConfirmation('Record this reviewed, sanitized sandbox result?', {
      title: 'Attach sandbox evidence',
      context: 'SecOpsAI stores the report identifier, score, and your bounded summary. It does not retain a raw report or treat the sandbox score alone as proof.',
      confirmLabel: 'Record result'
    }))) return;
    await runResearchCaseAction('sandbox-status', {
      case_id: researchCase.case_id,
      request_id: requestId,
      status,
      result: {
        id: submissionId,
        submission_id: submissionId,
        report_url: reportUrl,
        status,
        score: scoreText === '' ? null : Number(scoreText),
        summary,
      },
      actor: 'dashboard-operator'
    }, event.currentTarget);
  }));
  document.querySelectorAll('#research-case-detail .research-retract-btn').forEach(button => button.addEventListener('click', () => {
    openResearchRetractModal(researchCase, button.dataset.itemType, button.dataset.itemId);
  }));
}

function researchPipelineOperationalState(pipeline) {
  if (!pipeline) return { state: 'not_started', tone: 'neutral', pollMs: 0, message: '' };
  const jobs = (pipeline.steps || []).map(step => step.intelligence_job).filter(Boolean);
  const failed = jobs.find(job => job.status === 'failed');
  if (failed) {
    return {
      state: 'blocked',
      tone: 'danger',
      pollMs: 30000,
      message: failed.error_message || `Model job ${failed.job_id} failed and requires operator review.`,
    };
  }
  const waiting = jobs.find(job => job.status === 'awaiting_provider');
  if (waiting) {
    return {
      state: 'blocked',
      tone: 'danger',
      pollMs: 30000,
      message: waiting.error_message || `The selected model provider is unavailable for ${waiting.job_id}.`,
    };
  }
  const activeJobs = jobs.filter(job => ['queued', 'running'].includes(job.status));
  const oldestTimestamp = activeJobs.reduce((oldest, job) => {
    const parsed = Date.parse(job.updated_at || job.started_at || job.queued_at || '');
    return Number.isFinite(parsed) ? Math.min(oldest, parsed) : oldest;
  }, Number.POSITIVE_INFINITY);
  const ageMs = Number.isFinite(oldestTimestamp) ? Date.now() - oldestTimestamp : 0;
  if (activeJobs.length && ageMs > 10 * 60 * 1000) {
    return {
      state: 'stalled',
      tone: 'warning',
      pollMs: 30000,
      message: `${activeJobs.length} model job${activeJobs.length === 1 ? '' : 's'} have not advanced for ${Math.max(10, Math.floor(ageMs / 60000))} minutes. Open Automation to check the bridge and selected model.`,
    };
  }
  if (activeJobs.length || ['running', 'awaiting_ai'].includes(pipeline.status)) {
    return {
      state: 'active',
      tone: 'good',
      pollMs: 5000,
      message: 'The Local Codex Bridge is running the selected model against minimized case context. This view updates automatically.',
    };
  }
  return { state: 'settled', tone: 'neutral', pollMs: 0, message: '' };
}

function renderInvestigationPipeline(researchCase, ecosystems) {
  const pipelines = Array.isArray(researchCase.pipelines) ? researchCase.pipelines : [];
  const pipeline = pipelines[0] || null;
  const packageSubject = (researchCase.subjects || []).find(item => item.status === 'active' && ['package', 'extension'].includes(item.subject_type)) || {};
  const config = pipeline?.config || {};
  const reference = config.reference || {};
  const summary = pipeline?.summary || {};
  const steps = pipeline?.steps || [];
  const revisionPrefix = pipeline ? `r${pipeline.revision || 1}:` : '';
  const reviewItems = (pipeline?.review_items || []).filter(item => item.status !== 'superseded' && (!revisionPrefix || String(item.source_key || '').startsWith(revisionPrefix)));
  const pendingReview = reviewItems.filter(item => ['pending', 'applying'].includes(item.status));
  const operational = researchPipelineOperationalState(pipeline);
  const canStart = !pipeline || ['succeeded', 'canceled'].includes(pipeline.status);
  const comparisonNeeded = Boolean(summary.comparison_input_required || steps.some(step => step.step_key === 'collect_reference' && step.status === 'awaiting_input'));
  const canResume = pipeline && (pipeline.status === 'failed' || (comparisonNeeded && ['awaiting_input', 'awaiting_review', 'awaiting_ai'].includes(pipeline.status)));
  const agentVerdict = summary.agent_verdict
    ? `${statusLabel(summary.agent_verdict)} verdict at ${Number(summary.agent_verdict_confidence || 0)}% confidence`
    : '';
  const canonicalStages = [
    ['lead', 'Lead'],
    ['intake', 'Safe intake'],
    ['analysis', 'Analysis'],
    ['verdict', 'Verdict'],
    ['disclosure', 'Disclosure'],
    ['publication', 'Publication'],
    ['detections', 'Detections'],
    ['monitoring', 'Monitoring']
  ];
  const completedStepKeys = new Set(steps.filter(step => ['succeeded', 'completed', 'accepted'].includes(String(step.status || '').toLowerCase())).map(step => String(step.step_key || '').toLowerCase()));
  const stageIndex = !pipeline ? -1 : pipeline.status === 'succeeded' ? canonicalStages.length - 1 : Math.max(0, canonicalStages.findIndex(([key]) => {
    if (key === 'lead') return false;
    return steps.some(step => String(step.step_key || '').toLowerCase().includes(key) && !['succeeded', 'completed', 'accepted'].includes(String(step.status || '').toLowerCase()));
  }));
  const stageStepper = canonicalStages.map(([key, label], index) => {
    const state = index < stageIndex || (index === stageIndex && completedStepKeys.size > 0) ? 'complete' : index === stageIndex ? 'current' : 'pending';
    return `<li class="research-stage-step ${state}"><span class="research-stage-index">${index + 1}</span><span>${escapeHtml(label)}</span></li>`;
  }).join('');
  const statusCopy = !pipeline
    ? 'No investigation pipeline has run for this case.'
    : pipeline.status === 'awaiting_ai'
      ? operational.message
      : pipeline.status === 'awaiting_review'
        ? `${pendingReview.length} proposal${pendingReview.length === 1 ? '' : 's'} require an analyst decision.`
        : pipeline.status === 'failed'
          ? pipeline.error_message || 'The pipeline stopped safely and can be resumed.'
          : pipeline.status === 'succeeded'
            ? summary.autonomy_mode === 'agent_review'
              ? `Agent review completed${agentVerdict ? `: ${agentVerdict}` : ''}. External actions remain human-authorized.`
              : 'All pipeline proposals were reviewed. External sandbox, disclosure, and publication remain separate human gates.'
            : 'The pipeline is durable and can continue from its recorded step.';
  const stepRows = steps.length ? steps.map(step => {
    const job = step.intelligence_job || null;
    const effectiveStatus = job?.status || step.status;
    const jobStatus = step.intelligence_job_id
      ? ` · job <code>${escapeHtml(step.intelligence_job_id)}</code>${job?.attempt ? ` · attempt ${escapeHtml(String(job.attempt))}` : ''}`
      : '';
    const message = job?.error_message || step.error_message || step.result?.message || '';
    const updated = job?.updated_at ? `Last update ${fmtDate(job.updated_at)}` : '';
    return `<li class="research-pipeline-step ${escapeHtml(effectiveStatus)}"><span>${escapeHtml(statusLabel(step.step_key))}</span><span>${renderStatusPill(effectiveStatus)}${jobStatus}</span>${message || updated ? `<small>${escapeHtml([message, updated].filter(Boolean).join(' · '))}</small>` : ''}</li>`;
  }).join('') : '<li class="research-pipeline-step pending"><span>Waiting to start</span></li>';
  const reviewCards = reviewItems.length ? reviewItems.map(item => {
    const editable = pipeline.status === 'awaiting_review' && ['pending', 'applying'].includes(item.status);
    const content = item.edited_content || item.content || '';
    const groupedItems = Math.max(0, Number(item.metadata?.grouped_items || 0));
    return `<article class="research-review-item ${escapeHtml(item.status)}">
      <div class="research-review-head"><div><span class="detail-eyebrow">${escapeHtml(statusLabel(item.item_type))}</span><code>${escapeHtml(item.item_id)}</code></div>${renderStatusPill(item.status)}</div>
      <textarea id="research-review-content-${escapeHtml(item.item_id)}" rows="3" ${editable ? '' : 'readonly'}>${escapeHtml(content)}</textarea>
      <div class="small">Confidence ${escapeHtml(String(item.confidence))}%${groupedItems ? ` · ${escapeHtml(String(groupedItems))} grouped item${groupedItems === 1 ? '' : 's'}` : ''} · source ${escapeHtml((item.evidence_refs || []).join(', ') || 'pipeline')}</div>
      ${editable ? `<div class="research-form-actions"><button class="primary-btn research-pipeline-review-btn" data-pipeline-id="${escapeHtml(pipeline.pipeline_id)}" data-item-id="${escapeHtml(item.item_id)}" data-item-type="${escapeHtml(item.item_type)}" data-decision="accepted" type="button">Accept</button><button class="secondary-btn research-pipeline-review-btn" data-pipeline-id="${escapeHtml(pipeline.pipeline_id)}" data-item-id="${escapeHtml(item.item_id)}" data-item-type="${escapeHtml(item.item_type)}" data-decision="rejected" type="button">Reject</button></div>` : `<div class="small">Reviewed by ${escapeHtml(item.reviewer || 'operator')}${item.review_note ? ` · ${escapeHtml(item.review_note)}` : ''}</div>`}
    </article>`;
  }).join('') : '<div class="empty-state compact">Review proposals appear here after static collection and Local Codex analysis.</div>';
  return `<section class="research-pipeline-panel" aria-labelledby="research-pipeline-title">
    <div class="research-pipeline-heading">
      <div><div class="detail-eyebrow">GUARDED AGENT REVIEW</div><h5 id="research-pipeline-title">Investigation pipeline</h5><p class="small">Collect, compare, analyze, and reach an evidence-linked verdict without exporting files or copying prompts. Raw artifacts stay local and package code is never executed.</p></div>
      ${pipeline ? renderStatusPill(pipeline.status) : renderStatusPill('not_started', 'Not started')}
    </div>
    <div class="research-pipeline-summary"><strong>${escapeHtml(statusCopy)}</strong>${pipeline ? `<span><code>${escapeHtml(pipeline.pipeline_id)}</code> · revision ${escapeHtml(String(pipeline.revision || 1))}</span>` : ''}</div>
    ${['stalled', 'blocked'].includes(operational.state) ? `<div class="research-pipeline-operational tone-${escapeHtml(operational.tone)}"><div><strong>${operational.state === 'blocked' ? 'Model analysis is blocked' : 'Model analysis needs attention'}</strong><span>${escapeHtml(operational.message)}</span></div><div class="research-pipeline-operational-actions">${operational.state === 'stalled' ? '<button class="secondary-btn" id="research-pipeline-refresh-btn" type="button">Refresh status</button>' : ''}<button class="secondary-btn" id="research-pipeline-open-automation-btn" type="button">Open Automation</button></div></div>` : ''}
    <div class="research-form-grid research-pipeline-targets">
      <label><span>Investigated package</span><input value="${escapeHtml(`${packageSubject.ecosystem || 'unknown'}:${packageSubject.name || 'No package subject'}`)}" readonly /></label>
      <label><span>Reference ecosystem</span><select id="research-pipeline-reference-ecosystem">${ecosystems.map(value => researchOption(value, reference.ecosystem || packageSubject.ecosystem || 'npm')).join('')}</select></label>
      <label><span>Legitimate comparison package</span><input id="research-pipeline-reference-package" value="${escapeHtml(reference.package || '')}" placeholder="Required only when a trusted reference is known" /></label>
      <label><span>Reference version</span><input id="research-pipeline-reference-version" value="${escapeHtml(reference.version || '')}" placeholder="Latest stable when empty" /></label>
    </div>
    ${comparisonNeeded ? '<div class="research-pipeline-notice">Comparison is incomplete. SecOpsAI will not guess which package is legitimate. Enter a verified reference and resume.</div>' : ''}
  <div class="research-form-actions research-pipeline-actions">
      <button class="primary-btn" id="research-pipeline-start-btn" type="button" ${canStart ? '' : 'disabled'}>Run Investigation Pipeline</button>
    ${pipeline ? `<button class="secondary-btn" id="research-pipeline-resume-btn" type="button" ${canResume ? '' : 'disabled'}>${pipeline.status === 'failed' ? 'Retry from checkpoint' : 'Add reference and rerun analysis'}</button>` : ''}
  </div>
  <ol class="research-stage-stepper" aria-label="Investigation stages">${stageStepper}</ol>
  <ol class="research-pipeline-steps">${stepRows}</ol>
  <div class="research-review-list"><div class="research-list-head"><div><h5>Evidence and agent decision queue</h5><p class="small">Complete the guarded agent review in one action, or inspect and decide individual proposals. Every accepted item and verdict remains auditable.</p></div>${pipeline ? `
    <div style="display: flex; gap: 8px; align-items: center;">
      ${pendingReview.length > 0 ? `<button class="primary-btn mini-btn" id="research-pipeline-auto-review-btn" data-pipeline-id="${escapeHtml(pipeline.pipeline_id)}" type="button">Complete Agent Review</button>` : ''}
      <span class="status-pill">${pendingReview.length} pending</span>
    </div>` : ''}</div>${reviewCards}</div>
  <p class="small research-pipeline-boundary">Agent review may record a guarded, evidence-linked verdict. External sandbox submission, disclosure delivery, customer-control changes, and final publication still require your approval.</p>
</section>`;
}


function researchCasePrefill(researchCase = {}) {
  const subjects = researchCase.subjects || [];
  const packageSubject = subjects.find(item => item.subject_type === 'package' && item.status === 'active')
    || subjects.find(item => item.subject_type === 'package')
    || subjects[0]
    || {};
  const metadata = packageSubject.metadata && typeof packageSubject.metadata === 'object' ? packageSubject.metadata : {};
  const contacts = metadata.contacts && typeof metadata.contacts === 'object' ? metadata.contacts : {};
  const evidence = researchCase.evidence || [];
  const artifactEvidence = evidence.find(item => item.evidence_type === 'package_artifact' && item.status === 'active')
    || evidence.find(item => item.evidence_type === 'package_artifact')
    || null;
  const metadataEvidence = evidence.find(item => item.evidence_type === 'registry_metadata' && item.status === 'active')
    || evidence.find(item => item.evidence_type === 'registry_metadata')
    || null;
  const activeEvidenceIds = evidence
    .filter(item => item.status === 'active' && item.evidence_id)
    .map(item => item.evidence_id)
    .slice(0, 12);
  const latestVerdict = (researchCase.verdicts || [])[0] || {};
  const packageName = packageSubject.name || metadata.package || '';
  const packageVersion = packageSubject.version || metadata.version || '';
  const ecosystem = packageSubject.ecosystem || metadata.ecosystem || 'npm';
  const publisher = packageSubject.publisher || metadata.publisher || '';
  const packageLabel = [ecosystem, packageName, packageVersion].filter(Boolean).join(' / ') || researchCase.title || 'investigated package';
  const emails = Array.isArray(contacts.emails) ? contacts.emails.filter(Boolean) : [];
  const names = Array.isArray(contacts.names) ? contacts.names.filter(Boolean) : [];
  const urls = Array.isArray(contacts.urls) ? contacts.urls.filter(Boolean) : [];
  const registryContacts = {
    npm: 'security@npmjs.com',
    pypi: 'security@pypi.org',
    nuget: 'support@nuget.org',
    maven: 'security@central.sonatype.com',
    rubygems: 'security@rubygems.org',
    packagist: 'contact@packagist.org',
    go: 'security@golang.org',
    'open-vsx': 'security@eclipse.org'
  };
  const recipientCandidates = [...emails];
  if (!recipientCandidates.length && ecosystem) recipientCandidates.push(registryContacts[String(ecosystem).toLowerCase()] || 'security@secopsai.dev');
  if (!recipientCandidates.length) recipientCandidates.push('security@secopsai.dev');
  const recipient = recipientCandidates[0];
  const contactName = names[0] || publisher || 'maintainer';
  const artifactHash = artifactEvidence?.sha256 || metadata.artifact_sha256 || '';
  const metadataUrl = metadata.metadata_url || metadataEvidence?.locator || '';
  const artifactUrl = metadata.artifact_url || '';
  const subject = `Responsible disclosure: ${packageLabel}`.slice(0, 240);
  const body = [
    `Hello ${contactName},`,
    '',
    `SecOpsAI Research is preparing a responsible disclosure regarding ${packageLabel}.`,
    '',
    'We collected official registry metadata and preserved a hashed, quarantined artifact for defensive analysis. Package code was not installed or executed on analyst workstations.',
    '',
    'Relevant artifact hashes:',
    artifactHash ? `- ${artifactHash}` : '- Artifact hash available on request through the agreed channel.',
    '',
    'We can share reproduction-safe details, affected versions, and recommended mitigations through this channel. Please confirm the preferred security contact and any embargo expectations.',
    '',
    'Regards,',
    'SecOpsAI Research',
    'research@secopsai.dev'
  ].join('\n');
  const partnerReason = [
    `Requesting the exact package artifact for research case ${researchCase.case_id || ''}.`.trim(),
    `Package: ${packageLabel}`,
    publisher ? `Publisher: ${publisher}` : '',
    artifactHash ? `Expected SHA-256: ${artifactHash}` : 'Expected SHA-256: unknown; please provide the original hash and provenance.',
    metadataUrl ? `Registry metadata URL: ${metadataUrl}` : '',
    artifactUrl ? `Original artifact URL: ${artifactUrl}` : '',
    'Please include lawful source, chain of custody, and confirmation that the file was not modified.'
  ].filter(Boolean).join('\n');
  const sandboxJustification = [
    `Need isolated runtime confirmation for ${packageLabel}.`,
    'Static intake preserved a quarantined artifact without execution.',
    'Requested behaviors: network, process, file writes, credential access indicators.'
  ].join(' ');
  const artifactSource = metadataUrl
    ? `Official registry metadata/artifact reference: ${metadataUrl}`
    : (artifactUrl ? `Official artifact reference: ${artifactUrl}` : 'Authorized research copy with documented provenance.');
  const referencePackage = metadata.reference_package
    || packageSubject.reference_package
    || (researchCase.metadata && researchCase.metadata.reference_package)
    || '';
  const referenceVersion = metadata.reference_version
    || packageSubject.reference_version
    || (researchCase.metadata && researchCase.metadata.reference_version)
    || '';
  return {
    packageSubject,
    packageName,
    packageVersion,
    ecosystem,
    publisher,
    packageLabel,
    recipient,
    recipientCandidates,
    subject,
    body,
    partnerReason,
    sandboxJustification,
    artifactSource,
    artifactHash,
    activeEvidenceIds,
    latestVerdict,
    referencePackage,
    referenceVersion,
    contactName
  };
}

function renderResearchAutomationPanel(researchCase) {
  const prefill = researchCasePrefill(researchCase);
  const sandboxProvider = state.integrationStatus?.sandbox || {
    provider: 'tria.ge',
    configured: false,
    mode: 'manual-result-import',
    warning: 'Tria.ge public submissions are visible to the public and must not contain confidential data.'
  };
  const sandboxApiConfigured = Boolean(sandboxProvider.configured);
  const sandboxApiVerified = Boolean(sandboxProvider.verified && String(sandboxProvider.health || '').toLowerCase() === 'ready');
  const subjects = researchCase.subjects || [];
  const packageSubject = prefill.packageSubject || {};
  const artifact = (researchCase.evidence || []).find(item => item.evidence_type === 'package_artifact' && item.status === 'active');
  const jobs = (researchCase.jobs || []).slice(0, 12);
  const reviews = researchCase.publication_reviews || [];
  const disclosures = researchCase.disclosures || [];
  const sandboxes = researchCase.sandbox_requests || [];
  const caseEvidence = researchCase.evidence || [];
  const ecosystems = ['npm', 'pypi', 'nuget', 'maven', 'rubygems', 'packagist', 'go', 'open-vsx'];
  const artifacts = researchCase.artifacts || [];
  const sandboxRecommendation = researchCase.sandbox_recommendation || {};
  const recommendedArtifact = artifacts.find(item => String(item.sha256 || '').toLowerCase() === String(sandboxRecommendation.artifact_sha256 || '').toLowerCase());
  const latestVerdict = prefill.latestVerdict || {};
  const evidencePrefill = (prefill.activeEvidenceIds || []).join(', ');
  const recipientOptions = (prefill.recipientCandidates || []).map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  const recommendationReasons = Array.isArray(sandboxRecommendation.reasons) ? sandboxRecommendation.reasons : [];
  const recommendationBlockers = Array.isArray(sandboxRecommendation.blockers) ? sandboxRecommendation.blockers : [];
  const recommendationSummary = sandboxRecommendation.status === 'recommended'
    ? 'Dynamic analysis is recommended for this exact artifact. Request approval before any external submission.'
    : sandboxRecommendation.status === 'blocked'
      ? 'Dynamic analysis could help, but the exact hash-verified artifact is not attached yet.'
      : sandboxRecommendation.status === 'already_requested'
        ? 'A request already exists; do not create a duplicate submission.'
        : sandboxRecommendation.status === 'completed'
          ? 'Sandbox evidence is already attached. Review it before changing the case verdict.'
          : sandboxRecommendation.status === 'completed_unlinked'
            ? 'A sandbox result is marked complete, but it is not linked to case evidence yet. Record a valid sanitized report instead of creating a duplicate request.'
          : 'Static evidence does not currently justify dynamic analysis.';
  const recommendationMarkup = `<section class="research-sandbox-recommendation" aria-label="Dynamic analysis recommendation"><div class="research-sandbox-recommendation-head"><div><span class="detail-eyebrow">DYNAMIC ANALYSIS POLICY</span><h5>${escapeHtml(recommendationSummary)}</h5></div>${renderStatusPill(sandboxRecommendation.status || 'not_checked')}</div>${recommendationReasons.length ? `<ul>${recommendationReasons.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}<div class="research-sandbox-recommendation-meta"><span>Priority: <strong>${escapeHtml(sandboxRecommendation.priority || 'normal')}</strong></span><span>Score: <strong>${escapeHtml(String(sandboxRecommendation.score ?? 0))}</strong></span><span>Artifact: <code>${escapeHtml(sandboxRecommendation.artifact_sha256 ? String(sandboxRecommendation.artifact_sha256).slice(0, 16) + '…' : 'not attached')}</code></span></div>${recommendationBlockers.length ? `<div class="small research-sandbox-blockers"><strong>Blockers:</strong> ${escapeHtml(recommendationBlockers.join(' '))}</div>` : ''}<p class="small"><strong>Next:</strong> ${escapeHtml(sandboxRecommendation.next_action || 'Review the case evidence.')}</p>${sandboxRecommendation.status === 'recommended' && sandboxRecommendation.artifact_sha256 ? '<button class="secondary-btn mini-btn" id="research-sandbox-open-request-btn" type="button">Open approval request</button>' : ''}</section>`;
  return researchDetailSection('Research automation', `
    ${renderInvestigationPipeline(researchCase, ecosystems)}
    <p class="small">Safe intake fetches official metadata and artifacts into quarantine, hashes them, and performs bounded static inspection. It never installs or executes the package.</p>
    <div class="research-form-grid">
      <label><span>Ecosystem</span><select id="research-intake-ecosystem">${ecosystems.map(value => researchOption(value, packageSubject.ecosystem || 'npm')).join('')}</select></label>
      <label><span>Package</span><input id="research-intake-package" value="${escapeHtml(packageSubject.name || '')}" placeholder="package or group:artifact" /></label>
      <label><span>Version</span><input id="research-intake-version" value="${escapeHtml(packageSubject.version || '')}" placeholder="latest if empty" /></label>
      <label><span>Attach after collection</span><select id="research-intake-attach"><option value="false">Review first</option><option value="true">Attach immediately</option></select></label>
    </div>
    <div class="research-form-actions">
      <button class="secondary-btn" id="research-intake-preview-btn" type="button">Collect Metadata Preview</button>
      <button class="primary-btn" id="research-intake-run-btn" type="button">Run Safe Package Intake</button>
    </div>
    <details class="research-action-drawer"><summary>Local artifact evidence</summary><p class="small">Artifacts are sent only to the authenticated local helper, hashed, and stored in owner-only quarantine. They are never uploaded to Supabase, Render, Cloudflare, or an AI provider.</p><div class="research-form-grid"><label class="research-span-2"><span>Authorized package file</span><input id="research-artifact-file" type="file" accept=".nupkg,.zip,.vsix,.gem,.whl" /></label><label class="research-span-2"><span>Lawful source and authorization</span><input id="research-artifact-source" value="${escapeHtml(prefill.artifactSource || '')}" placeholder="e.g. Downloaded from nuget.org before removal; authorized research copy" /></label><label><span>Ecosystem</span><select id="research-artifact-ecosystem">${ecosystems.map(value => researchOption(value, packageSubject.ecosystem || 'nuget')).join('')}</select></label><label><span>Package</span><input id="research-artifact-package" value="${escapeHtml(packageSubject.name || '')}" /></label><label><span>Version</span><input id="research-artifact-version" value="${escapeHtml(packageSubject.version || '')}" /></label></div><div class="research-form-actions"><button class="primary-btn" id="research-artifact-import-btn" type="button">Import Authorized Artifact</button><button class="secondary-btn" id="research-artifact-ioc-btn" type="button" ${artifacts.length ? '' : 'disabled'}>Extract IOC Candidates</button></div>${artifacts.length ? `<div class="research-form-grid"><label><span>Compare left artifact</span><select id="research-artifact-left">${artifacts.map(item => `<option value="${escapeHtml(item.artifact_id)}">${escapeHtml(item.artifact_id)} · ${escapeHtml(item.version || 'unknown')}</option>`).join('')}</select></label><label><span>Compare right artifact</span><select id="research-artifact-right">${artifacts.map((item, index) => `<option value="${escapeHtml(item.artifact_id)}" ${index === 1 ? 'selected' : ''}>${escapeHtml(item.artifact_id)} · ${escapeHtml(item.version || 'unknown')}</option>`).join('')}</select></label><button class="secondary-btn" id="research-artifact-compare-btn" type="button" ${artifacts.length > 1 ? '' : 'disabled'}>Compare local artifacts</button></div><div class="table-wrap"><table><thead><tr><th>Artifact</th><th>Package</th><th>SHA-256</th><th>State</th><th>Actions</th></tr></thead><tbody>${artifacts.map(item => `<tr><td><strong>${escapeHtml(item.artifact_id)}</strong><div class="small">${escapeHtml(item.filename)}</div></td><td>${escapeHtml(item.ecosystem)}:${escapeHtml(item.package_name || '—')}@${escapeHtml(item.version || '—')}</td><td><code>${escapeHtml(item.sha256)}</code></td><td>${escapeHtml(statusLabel(item.state))}</td><td><button class="mini-btn research-artifact-analysis-btn" data-artifact-id="${escapeHtml(item.artifact_id)}" type="button">Inspect safely</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state compact">No local artifacts attached. Import an authorized package file to begin.</div>'}</details>
    <details class="research-action-drawer"><summary>Compare packages</summary><p class="small">Both exact targets are fetched from allowlisted registries, hashed, and inspected statically. Package code is never installed or executed. Left defaults to the trusted reference when known; right defaults to the investigated package.</p><div class="research-form-grid"><label><span>Left ecosystem</span><select id="research-compare-left-ecosystem">${ecosystems.map(value => researchOption(value, packageSubject.ecosystem || 'npm')).join('')}</select></label><label><span>Left package</span><input id="research-compare-left-package" value="${escapeHtml(prefill.referencePackage || packageSubject.name || '')}" placeholder="legitimate package" /></label><label><span>Left version</span><input id="research-compare-left-version" value="${escapeHtml(prefill.referenceVersion || '')}" placeholder="latest if empty" /></label><label><span>Right ecosystem</span><select id="research-compare-right-ecosystem">${ecosystems.map(value => researchOption(value, packageSubject.ecosystem || 'npm')).join('')}</select></label><label><span>Right package</span><input id="research-compare-right-package" value="${escapeHtml(packageSubject.name || '')}" placeholder="candidate package" /></label><label><span>Right version</span><input id="research-compare-right-version" value="${escapeHtml(packageSubject.version || '')}" placeholder="latest if empty" /></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-compare-packages-btn" type="button">Compare exact packages</button></div></details>
    <div class="research-form-grid">
      <label><span>Analyst verdict</span><select id="research-verdict-value">${['inconclusive','credible','likely','not_substantiated','benign','retracted'].map(value => researchOption(value, latestVerdict.verdict || 'inconclusive')).join('')}</select></label>
      <label><span>Confidence</span><input id="research-verdict-confidence" type="number" min="0" max="100" value="${escapeHtml(String(latestVerdict.confidence ?? 50))}" /></label>
      <label class="research-span-2"><span>Rationale</span><textarea id="research-verdict-rationale" rows="2" placeholder="Explain the evidence and limitations.">${escapeHtml(latestVerdict.rationale || '')}</textarea></label>
      <label class="research-span-2"><span>Evidence IDs</span><input id="research-verdict-evidence" value="${escapeHtml(Array.isArray(latestVerdict.evidence_ids) && latestVerdict.evidence_ids.length ? latestVerdict.evidence_ids.join(', ') : evidencePrefill)}" placeholder="EVD-..., EVD-..." /></label>
    </div>
    <div class="research-form-actions"><button class="secondary-btn" id="research-verdict-btn" type="button">Record Human Verdict</button><button class="secondary-btn" id="research-publication-approve-btn" type="button" ${reviews[0]?.status === 'needs_approval' ? '' : 'disabled'}>Approve Publication Review</button></div>
    <details class="research-action-drawer" open><summary>Prepare responsible disclosure</summary><p class="small">Recipient, subject, and body are prefilled from case subjects, registry contacts, and artifact hashes. Review before preparing the draft. Sending remains a separate approval gate.</p><div class="research-form-grid"><label><span>Recipient</span><input id="research-disclosure-recipient" list="research-disclosure-recipient-options" value="${escapeHtml(prefill.recipient || '')}" placeholder="maintainer or registry contact" /><datalist id="research-disclosure-recipient-options">${recipientOptions}</datalist></label><label><span>Subject</span><input id="research-disclosure-subject" value="${escapeHtml(prefill.subject || '')}" /></label><label class="research-span-2"><span>Body</span><textarea id="research-disclosure-body" rows="8" placeholder="Leave empty for the safe template.">${escapeHtml(prefill.body || '')}</textarea></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-disclosure-suggest-btn" type="button">Refresh Suggested Draft</button><button class="primary-btn" id="research-disclosure-btn" type="button">Prepare Disclosure</button></div></details>
    <details class="research-action-drawer"><summary>Acquire an unavailable artifact</summary><p class="small">Use this when an official registry no longer serves the exact version. The request is an auditable draft and does not send email automatically or change the case verdict.</p><div class="research-form-grid"><label><span>Research partner or contact</span><input id="research-partner-recipient" value="${escapeHtml(prefill.recipient || '')}" placeholder="security@partner.example" /></label><label class="research-span-2"><span>Reason and requested provenance</span><textarea id="research-partner-reason" rows="5" placeholder="Request the exact package, original source, and chain of custody.">${escapeHtml(prefill.partnerReason || '')}</textarea></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-partner-request-btn" type="button">Request Artifact From Research Partner</button></div>${(researchCase.partner_requests || []).slice(0, 3).map(item => `<div class="feed-item"><code>${escapeHtml(item.request_id)}</code> · ${escapeHtml(statusLabel(item.status))} · ${escapeHtml(item.recipient)}</div>`).join('')}</details>
    ${recommendationMarkup}
    <details class="research-action-drawer" id="research-sandbox-request-drawer"><summary>Request dynamic sandbox analysis</summary><p class="small">Create an approval record for one exact artifact hash. ${sandboxApiConfigured ? `Tria.ge API access is configured on the local helper${sandboxApiVerified ? ' and the read-only API check passed' : '; verify the read-only API before submitting'}. After approval, SecOpsAI can submit the exact hash-verified artifact through the server-side token and poll the sanitized result.` : 'Tria.ge API access is not configured, so an approved request prepares a hash-verified browser download for manual public upload.'} SecOpsAI never executes the sample locally. ${escapeHtml(sandboxProvider.warning || '')}</p><div class="research-form-grid"><label class="research-span-2"><span>Artifact SHA-256</span><input id="research-sandbox-sha256" value="${escapeHtml(sandboxRecommendation.artifact_sha256 || recommendedArtifact?.sha256 || artifact?.sha256 || prefill.artifactHash || '')}" /></label><label class="research-span-2"><span>Justification</span><textarea id="research-sandbox-justification" rows="3">${escapeHtml(prefill.sandboxJustification || recommendationReasons.join(' '))}</textarea></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-sandbox-btn" type="button" ${sandboxRecommendation.status === 'blocked' || !sandboxRecommendation.artifact_sha256 && !recommendedArtifact?.sha256 && !artifact?.sha256 && !prefill.artifactHash ? 'disabled' : ''}>Request Sandbox Approval</button></div></details>
    <div class="research-automation-status">
      <strong>Jobs and approvals</strong>
      ${jobs.length ? jobs.map(job => `<div class="feed-item"><code>${escapeHtml(job.job_id)}</code> · ${escapeHtml(statusLabel(job.status))} · ${escapeHtml(statusLabel(job.action))}${job.status === 'awaiting_review' ? ` <button class="mini-btn research-intake-attach-btn" data-job-id="${escapeHtml(job.job_id)}" type="button">Attach Verified Evidence</button>` : ''}${['failed','expired','canceled'].includes(job.status) ? ` <button class="mini-btn research-job-retry-btn" data-job-id="${escapeHtml(job.job_id)}" type="button">Retry</button>` : ''}${['queued','running','awaiting_review'].includes(job.status) ? ` <button class="mini-btn research-job-cancel-btn" data-job-id="${escapeHtml(job.job_id)}" type="button">Cancel</button>` : ''}</div>`).join('') : '<div class="small">No automated research jobs yet.</div>'}
      ${reviews.length ? `<div class="small">Latest publication review: <strong>${escapeHtml(statusLabel(reviews[0].status))}</strong>${(reviews[0].blockers || []).length ? ` · ${(reviews[0].blockers || []).length} blocker(s)` : ''}</div>` : ''}
      ${disclosures.length ? disclosures.slice(0, 3).map(item => `<div class="feed-item"><code>${escapeHtml(item.disclosure_id)}</code> · ${escapeHtml(statusLabel(item.status))} · ${escapeHtml(item.recipient)} <button class="mini-btn research-disclosure-status-btn" data-disclosure-id="${escapeHtml(item.disclosure_id)}" data-disclosure-status="approved" type="button">Approve</button><button class="mini-btn research-disclosure-status-btn" data-disclosure-id="${escapeHtml(item.disclosure_id)}" data-disclosure-status="sent" type="button">Record Sent</button></div>`).join('') : ''}
      ${sandboxes.length ? sandboxes.slice(0, 3).map(item => {
        const matchingArtifact = artifacts.find(candidate => String(candidate.sha256 || '').toLowerCase() === String(item.artifact_sha256 || '').toLowerCase());
        const artifactAvailable = Boolean(matchingArtifact?.available ?? matchingArtifact);
        const canSubmit = sandboxApiConfigured && item.status === 'approved' && artifactAvailable;
        const canPoll = sandboxApiConfigured && item.status === 'submitted';
        const canPrepare = !sandboxApiConfigured && item.status === 'approved' && artifactAvailable;
        const linkedEvidence = caseEvidence.find(candidate => {
          if (candidate.evidence_type !== 'sandbox_analysis' || candidate.status === 'retracted') return false;
          const metadata = candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {};
          const requestIds = Array.isArray(metadata.sandbox_request_ids) ? metadata.sandbox_request_ids : [];
          return metadata.sandbox_request_id === item.request_id || requestIds.includes(item.request_id);
        });
        const canRecord = (!sandboxApiConfigured && ['approved', 'submitted'].includes(item.status))
          || (item.status === 'completed' && !linkedEvidence);
        const completionNote = item.status === 'completed'
          ? (linkedEvidence ? ` · sandbox evidence linked ${escapeHtml(linkedEvidence.evidence_id)}` : ' · result recorded; evidence link needs a valid report')
          : '';
        const repairLink = item.status === 'completed' && !linkedEvidence
          ? ` <button class="mini-btn research-sandbox-reconcile-btn" data-case-id="${escapeHtml(researchCase.case_id)}" type="button">Repair evidence link</button>`
          : '';
        return `<div class="feed-item sandbox-workflow-item"><code>${escapeHtml(item.request_id)}</code> · ${escapeHtml(statusLabel(item.status))}${completionNote} · provider ${escapeHtml(sandboxApiConfigured ? 'tria.ge api' : item.provider)}${item.status === 'pending_approval' ? ` <button class="mini-btn research-sandbox-status-btn" data-request-id="${escapeHtml(item.request_id)}" data-sandbox-action="sandbox-approve" data-sandbox-status="approved" type="button">Approve public submission</button>` : ''}${canSubmit ? ` <button class="mini-btn research-sandbox-submit-btn" data-request-id="${escapeHtml(item.request_id)}" type="button">Submit to Tria.ge</button>` : ''}${canPoll ? ` <button class="mini-btn research-sandbox-poll-btn" data-request-id="${escapeHtml(item.request_id)}" type="button">Refresh Tria.ge result</button>` : ''}${canPrepare ? ` <button class="mini-btn research-sandbox-download-btn" data-request-id="${escapeHtml(item.request_id)}" type="button">Download exact sample</button>` : ''}${repairLink}${canRecord ? `<details class="research-inline-state"><summary>Record manual Tria.ge result</summary><p class="small">A completed result is linked automatically when the report URL, submission ID, and summary are valid. Re-record only if the previous result could not be linked.</p><div class="research-form-grid"><label class="research-span-2"><span>Public report URL</span><input id="research-sandbox-result-url-${escapeHtml(item.request_id)}" placeholder="https://tria.ge/analysis-id" /></label><label><span>Result state</span><select id="research-sandbox-result-status-${escapeHtml(item.request_id)}"><option value="completed">Completed</option><option value="failed">Failed</option></select></label><label><span>Tria.ge score</span><input id="research-sandbox-result-score-${escapeHtml(item.request_id)}" type="number" min="0" max="10" step="0.1" /></label><label class="research-span-2"><span>Reviewed behavior summary</span><textarea id="research-sandbox-result-summary-${escapeHtml(item.request_id)}" rows="4" placeholder="Record observed runtime behavior, important limitations, and whether indicators were independently validated."></textarea></label><button class="mini-btn research-sandbox-result-btn" data-request-id="${escapeHtml(item.request_id)}" type="button">Attach sanitized result</button></div></details>` : ''}</div>`;
      }).join('') : ''}
    </div>
  `);
}

function reliabilityActionButton({ id, label, enabled, reason, primary = false }) {
  const blockedReason = enabled ? '' : String(reason || 'Complete the preceding reliability stage first.');
  return `<div class="research-reliability-action"><button class="${primary ? 'primary-btn' : 'secondary-btn'}" id="${escapeHtml(id)}" type="button" ${enabled ? '' : 'disabled'} title="${escapeHtml(enabled ? reason || label : blockedReason)}">${escapeHtml(label)}</button><span>${escapeHtml(enabled ? reason || 'Records a versioned, auditable result.' : blockedReason)}</span></div>`;
}

function latestReliabilityBundle(bundles, stage) {
  return (bundles || []).find(item => item.stage === stage) || null;
}

function renderExecutionGroundedResearch(researchCase) {
  const reliability = researchCase.research_reliability || {};
  const hypotheses = reliability.hypotheses || [];
  const selectedHypotheses = hypotheses.filter(item => item.status === 'selected');
  const plans = reliability.plans || [];
  const plan = plans[0] || null;
  const bundles = reliability.run_bundles || [];
  const scaffold = latestReliabilityBundle(bundles, 'scaffold');
  const transition = latestReliabilityBundle(bundles, 'transition');
  const full = latestReliabilityBundle(bundles, 'full');
  const claims = reliability.effective_claim_ledger || reliability.claim_ledger || [];
  const unsupported = claims.filter(item => ['unsupported', 'contradicted'].includes(item.support_status));
  const contradictions = claims.filter(item => (item.contradicting_evidence || []).length || item.support_status === 'contradicted');
  const review = reliability.specialist_review || { status: 'not_started', publication_blocked: true };
  const audits = reliability.latest_audits || {};
  const auditPassed = type => audits[type]?.status === 'passed';
  const fullReady = full?.status === 'succeeded' && full?.verification?.tamper_evident;
  const reviewReady = review.status === 'completed'
    && (!review.material_disagreement
      || ['resolved_primary', 'resolved_reviewer'].includes(String(review.adjudication_status || '')));
  const reliabilityReady = fullReady && claims.length > 0 && unsupported.length === 0 && reviewReady
    && ['completeness', 'originality', 'visual_qa'].every(auditPassed);
  const runRows = ['scaffold', 'transition', 'full'].map(stage => {
    const bundle = latestReliabilityBundle(bundles, stage);
    return `<div class="research-reliability-stage"><span>${escapeHtml(humanizeSnake(stage))}</span>${renderStatusPill(bundle?.status || 'not_started')}<small>${bundle ? `${escapeHtml(String(bundle.completeness_score || 0))}% logged · ${bundle.verification?.tamper_evident ? 'integrity verified' : 'integrity not verified'}` : 'No run bundle yet'}</small></div>`;
  }).join('');
  const auditRows = ['completeness', 'originality', 'visual_qa'].map(type => {
    const audit = audits[type];
    return `<div class="research-reliability-stage"><span>${escapeHtml(humanizeSnake(type))}</span>${renderStatusPill(audit?.status || 'not_started')}<small>${audit ? `Score ${escapeHtml(String(audit.score || 0))} · ${(audit.hard_blockers || []).length} blocker(s)` : 'Required before publication approval'}</small></div>`;
  }).join('');
  const claimRows = claims.slice(0, 12).map(item => `<tr><td>${escapeHtml(compactText(item.text_span || '', 180))}</td><td>${escapeHtml(humanizeSnake(item.claim_type || 'other'))}</td><td>${renderStatusPill(item.support_status || 'unknown')}</td><td>${escapeHtml((item.evidence_ids || []).join(', ') || 'None')}</td></tr>`);
  const hypothesisRows = hypotheses.slice(0, 6).map(item => `<tr><td>${escapeHtml(humanizeSnake(item.hypothesis_type))}</td><td>${escapeHtml(compactText(item.statement || '', 180))}</td><td>${escapeHtml(String(item.rank || '—'))}</td><td>${renderStatusPill(item.status || 'candidate')}</td></tr>`);
  const next = reliability.next_action || { label: 'Generate competing hypotheses', reason: 'Research begins with falsifiable alternatives.' };
  const specialistRun = review.run || null;
  const primaryComplete = Boolean(specialistRun?.result);
  const blindQueued = Boolean(specialistRun?.reviewer_job_id);
  const adjudicationPending = Boolean(
    review.material_disagreement
    && !['resolved_primary', 'resolved_reviewer'].includes(String(review.adjudication_status || '')),
  );
  const adjudicationRunId = String(specialistRun?.run_id || '');
  const adjudicationStatus = String(review.adjudication_status || 'not_required');
  const latestAutomation = (reliability.automation_runs || [])[0] || null;
  const hasAutomationInputs = (researchCase.subjects || []).some(item => item.status !== 'retracted')
    && (researchCase.evidence || []).some(item => item.status !== 'retracted');
  return `<section class="research-reliability-workspace" aria-labelledby="research-reliability-title">
    <div class="research-reliability-head"><div><span class="detail-eyebrow">EXECUTION-GROUNDED RESEARCH</span><h4 id="research-reliability-title">Evidence reliability workspace</h4><p>Each conclusion must trace to a safe run bundle and canonical evidence. Models review evidence; they do not create facts.</p></div>${renderStatusPill(reliabilityReady ? 'ready' : 'blocked')}</div>
    <div class="research-reliability-next"><strong>Next: ${escapeHtml(next.label || humanizeSnake(next.action || 'review'))}</strong><span>${escapeHtml(next.reason || 'Complete the next recorded reliability gate.')}</span></div>
    <div class="research-reliability-actions research-reliability-automation-actions" aria-label="Guarded research automation">
      ${reliabilityActionButton({ id: 'research-reliability-auto-btn', label: 'Run Safe Automation', enabled: hasAutomationInputs, primary: true, reason: hasAutomationInputs ? 'Advances every deterministic gate, queues one guarded read-only specialist review when ready, and stops at evidence or human approval boundaries.' : 'Add at least one structured subject and one evidence record first.' })}
      ${latestAutomation ? `<div class="research-reliability-automation-status"><strong>Last automation: ${escapeHtml(humanizeSnake(latestAutomation.stopped_at || latestAutomation.status || 'completed'))}</strong><span>${escapeHtml(latestAutomation.reason || 'The guarded run completed its available steps.')}</span><small>${escapeHtml(String((latestAutomation.automated_steps || []).length))} safe step(s) · next ${escapeHtml(humanizeSnake(latestAutomation.next_action || 'operator review'))}</small></div>` : '<div class="research-reliability-automation-status"><strong>No guarded run recorded yet</strong><span>Run Safe Automation records every completed step and the exact decision boundary where it stops.</span></div>'}
    </div>
    <details class="research-reliability-manual"><summary>Manual stage controls and recovery</summary>
    <div class="research-reliability-actions" aria-label="Research reliability actions">
      ${reliabilityActionButton({ id: 'research-reliability-hypotheses-btn', label: 'Generate Hypotheses', enabled: true, reason: 'Creates six bounded malicious, benign, false-positive, unrelated, provenance, and insufficient-evidence alternatives.' })}
      ${reliabilityActionButton({ id: 'research-reliability-rank-btn', label: 'Rank Hypotheses', enabled: hypotheses.length > 1, reason: hypotheses.length > 1 ? 'Uses deterministic pairwise evidence value, uncertainty, safety, impact, and cost.' : 'Generate competing hypotheses first.' })}
      ${reliabilityActionButton({ id: 'research-reliability-plan-btn', label: plan ? 'Revise Evidence Plan' : 'Create Evidence Plan', enabled: selectedHypotheses.length > 0, reason: selectedHypotheses.length ? 'Versions intended methods, limits, expected outputs, and completion criteria.' : 'Rank and select hypotheses first.' })}
      ${reliabilityActionButton({ id: 'research-reliability-scaffold-btn', label: 'Run Scaffold Research', enabled: Boolean(plan), reason: plan ? 'Validates adapters, identities, checksums, scope, and limits on the smallest safe sample.' : 'Create an evidence plan first.', primary: !scaffold })}
      ${reliabilityActionButton({ id: 'research-reliability-transition-btn', label: 'Verify Transition', enabled: scaffold?.status === 'succeeded', reason: scaffold?.status === 'succeeded' ? 'Proves mocks, fixtures, stubs, placeholders, and synthetic outputs cannot enter full research.' : 'A successful scaffold bundle is required.' })}
      ${reliabilityActionButton({ id: 'research-reliability-full-btn', label: 'Run Full Safe Research', enabled: transition?.status === 'succeeded', reason: transition?.status === 'succeeded' ? 'Processes approved metadata, archives, comparisons, local exposure, and imported sandbox results without local execution.' : 'Transition verification must pass.' })}
      ${reliabilityActionButton({ id: 'research-reliability-claims-btn', label: 'Build Claim Ledger', enabled: fullReady, reason: fullReady ? 'Extracts every factual statement and checks identifiers, numbers, dates, hashes, IOCs, and runtime claims.' : 'A successful tamper-evident full bundle is required.' })}
      ${reliabilityActionButton({ id: 'research-reliability-verify-btn', label: 'Verify Claims', enabled: claims.length > 0, reason: claims.length ? 'Rechecks every stored claim against current canonical records.' : 'Build the claim ledger first.' })}
      ${reliabilityActionButton({ id: 'research-reliability-clip-btn', label: 'Resolve Unsupported Claims', enabled: unsupported.length > 0, reason: unsupported.length ? 'Produces an auditable correction diff; it does not silently invent support.' : 'No unsupported or contradicted claim currently needs correction.' })}
      ${reliabilityActionButton({ id: 'research-reliability-specialist-btn', label: 'Run Specialist', enabled: fullReady && claims.length > 0 && unsupported.length === 0 && !specialistRun, reason: !fullReady ? 'Complete full safe research first.' : !claims.length ? 'Build the claim ledger first.' : unsupported.length ? 'Resolve unsupported claims first.' : specialistRun ? 'A specialist run already exists.' : 'Routes the reviewed domain specialist on the persisted OpenCodex model.' })}
      ${reliabilityActionButton({ id: 'research-reliability-blind-btn', label: 'Run Blind Review', enabled: primaryComplete && !blindQueued && !specialistRun?.review, reason: !primaryComplete ? 'The primary specialist must complete first.' : specialistRun?.review ? 'Blind review is already complete.' : blindQueued ? 'Blind review is already queued.' : 'Queues a separate reviewer without the primary verdict, confidence, wording, or recommendation.' })}
      ${reliabilityActionButton({ id: 'research-reliability-completeness-btn', label: 'Audit Completeness', enabled: claims.length > 0, reason: claims.length ? 'Checks omitted failures, selective reporting, methodology divergence, and fixture leakage.' : 'Build and verify claims first.' })}
      ${reliabilityActionButton({ id: 'research-reliability-originality-btn', label: 'Check Originality', enabled: claims.length > 0, reason: claims.length ? 'Checks source similarity and attribution without treating reporting domains as attacker IOCs.' : 'Build the claim ledger first.' })}
      ${reliabilityActionButton({ id: 'research-reliability-visual-btn', label: 'Render Publication Preview', enabled: auditPassed('completeness') && auditPassed('originality'), reason: auditPassed('completeness') && auditPassed('originality') ? 'Renders deterministic desktop/mobile previews and checks overflow, contrast, alt text, and licensing.' : 'Completeness and originality audits must pass first.' })}
      ${reliabilityActionButton({ id: 'research-publication-check-btn', label: 'Run Publication Safety', enabled: reliabilityReady, reason: reliabilityReady ? 'Runs the final safety gate. Human approval is still required.' : 'Complete all execution-grounded reliability stages first.' })}
      ${reliabilityActionButton({ id: 'research-draft-blog-btn', label: 'Create Review-Only Draft', enabled: reliabilityReady && researchCase.status === 'ready_to_publish' && (researchCase.publication_reviews || [])[0]?.status === 'approved', reason: 'Creates an editorial draft only; it does not publish or deploy.' })}
      ${reliabilityActionButton({ id: 'research-reliability-publish-btn', label: 'Publish Approved', enabled: true, reason: 'Opens Publications. Approval and staging remain a separate protected action.' })}
      ${reliabilityActionButton({ id: 'research-reliability-deploy-btn', label: 'Deploy', enabled: true, reason: 'Opens Publications. Cloudflare deployment remains separate and protected.' })}
    </div>
    </details>
    <div class="research-reliability-grid">
      <article><h5>Hypotheses</h5>${hypotheses.length ? researchTable(['Type','Statement','Rank','State'], hypothesisRows, '') : '<div class="empty-state compact">No hypotheses yet.</div>'}</article>
      <article><h5>Evidence plan</h5>${plan ? `<p><strong>Revision ${escapeHtml(String(plan.revision))}</strong> · ${escapeHtml(plan.status || 'planned')}</p><p class="small">${escapeHtml((plan.intended_methods || []).join(', ') || 'No intended methods recorded.')}</p><p class="small">Executed: ${escapeHtml((plan.executed_methods || []).join(', ') || 'none yet')}</p>` : '<div class="empty-state compact">No versioned plan yet.</div>'}</article>
      <article><h5>Research runs</h5><div class="research-reliability-stages">${runRows}</div></article>
      <article><h5>Specialist and blind review</h5><div class="research-reliability-stages"><div class="research-reliability-stage"><span>Domain specialist</span>${renderStatusPill(specialistRun?.status || 'not_started')}<small>${escapeHtml(specialistRun?.profile_id || 'Not routed')}</small></div><div class="research-reliability-stage"><span>Independent review</span>${renderStatusPill(review.status || 'not_started')}<small>${review.material_disagreement ? (['resolved_primary', 'resolved_reviewer'].includes(adjudicationStatus) ? `Resolved by ${escapeHtml(adjudicationStatus.replace('resolved_', ''))}.` : `Material disagreement: ${escapeHtml(adjudicationStatus)}.`) : 'Primary verdict and persuasive wording are withheld.'}</small></div></div>${adjudicationPending && adjudicationRunId ? `<div class="research-adjudication-panel"><p class="small"><strong>Human adjudication required.</strong> Review both evidence-linked outputs before resolving this disagreement. The decision is recorded in the audit trail and does not publish automatically.</p><div class="research-form-grid"><label><span>Decision</span><select id="research-adjudication-decision"><option value="accept_primary">Accept primary</option><option value="accept_reviewer">Accept independent reviewer</option><option value="request_more_evidence">Request more evidence</option></select></label><label class="research-span-2"><span>Evidence-backed rationale</span><textarea id="research-adjudication-rationale" rows="3" minlength="20" maxlength="8000" placeholder="Explain which evidence supports this decision (minimum 20 characters)."></textarea></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-reliability-adjudicate-btn" type="button" data-run-id="${escapeHtml(adjudicationRunId)}">Record adjudication</button></div></div>` : ''}</article>
      <article class="research-reliability-wide"><h5>Claim ledger</h5>${claims.length ? researchTable(['Claim','Type','Support','Evidence'], claimRows, '') : '<div class="empty-state compact">No claim ledger yet.</div>'}</article>
      <article><h5>Contradictions</h5>${contradictions.length ? renderBulletList(contradictions.slice(0, 8).map(item => `${item.text_span}: ${(item.contradicting_evidence || []).join('; ') || 'contradicted by canonical evidence'}`), '') : '<div class="empty-state compact">No recorded contradictions.</div>'}</article>
      <article><h5>Completeness and publication quality</h5><div class="research-reliability-stages">${auditRows}</div></article>
    </div>
    <p class="small research-pipeline-boundary">Sandbox submission, disclosure, publication approval, publishing, deployment, destructive response, and external communication remain human-approved. No package or payload runs locally.</p>
  </section>`;
}

function parsedCssRgb(value) {
  const match = String(value || '').match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
}

function cssRelativeLuminance(rgb) {
  const channels = rgb.slice(0, 3).map(value => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function cssContrastRatio(foreground, background) {
  const lighter = Math.max(cssRelativeLuminance(foreground), cssRelativeLuminance(background));
  const darker = Math.min(cssRelativeLuminance(foreground), cssRelativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function publicationPreviewChecks(researchCase) {
  const preview = document.createElement('article');
  preview.className = 'research-publication-preview-probe';
  preview.setAttribute('aria-label', 'Publication visual QA preview');
  preview.innerHTML = `<h1>${escapeHtml(researchCase.title || 'Untitled research')}</h1><p>${escapeHtml(researchCase.summary || '')}</p><table><thead><tr><th>Evidence</th><th>Type</th></tr></thead><tbody>${(researchCase.evidence || []).slice(0, 20).map(item => `<tr><td>${escapeHtml(item.title || '')}</td><td>${escapeHtml(humanizeSnake(item.evidence_type || 'other'))}</td></tr>`).join('')}</tbody></table><pre><code>${escapeHtml((researchCase.subjects || []).map(item => `${item.ecosystem || ''}:${item.name || ''}@${item.version || ''}`).join('\n'))}</code></pre>`;
  document.body.appendChild(preview);
  let overflowCount = 0;
  let desktopRendered = false;
  let mobileRendered = false;
  for (const [width, mode] of [[1120, 'desktop'], [390, 'mobile']]) {
    preview.style.width = `${width}px`;
    const bounds = preview.getBoundingClientRect();
    const overflow = [preview, ...preview.querySelectorAll('*')].filter(node => node.scrollWidth > node.clientWidth + 1).length;
    overflowCount += overflow;
    if (mode === 'desktop') desktopRendered = bounds.width >= 1000;
    if (mode === 'mobile') mobileRendered = bounds.width >= 360 && bounds.width <= 420;
  }
  let contrastFailures = 0;
  if (typeof window.getComputedStyle === 'function') {
    const nodes = [preview, ...preview.querySelectorAll('h1,p,th,td,pre,code')];
    for (const node of nodes) {
      const style = window.getComputedStyle(node);
      const foreground = parsedCssRgb(style.color);
      let background = null;
      for (let current = node; current && !background; current = current.parentElement) {
        const candidate = parsedCssRgb(window.getComputedStyle(current).backgroundColor);
        if (candidate && candidate[3] > 0.05) background = candidate;
      }
      background ||= [255, 255, 255, 1];
      if (!foreground || cssContrastRatio(foreground, background) < 4.5) contrastFailures += 1;
    }
  } else {
    contrastFailures = 1;
  }
  const imageEvidence = (researchCase.evidence || []).filter(item => item.evidence_type === 'screenshot' && item.status !== 'retracted');
  const visualScreenshots = imageEvidence.filter(item => ['desktop', 'mobile'].includes(String(item.metadata?.visual_qa_viewport || '').toLowerCase()));
  const missingAltText = imageEvidence.filter(item => !String(item.metadata?.alt || item.notes || '').trim()).length;
  const unlicensedImages = imageEvidence.filter(item => !String(item.metadata?.license || item.metadata?.source_attribution || item.provenance || '').trim()).length;
  preview.remove();
  return {
    desktop_rendered: desktopRendered,
    mobile_rendered: mobileRendered,
    overflow_count: overflowCount,
    contrast_failures: contrastFailures,
    missing_alt_text: missingAltText,
    unlicensed_images: unlicensedImages,
    screenshots: visualScreenshots.map(item => `${String(item.metadata.visual_qa_viewport).toLowerCase()}=${item.locator}`).filter(Boolean).slice(0, 4),
  };
}

function bindReliabilityCaseActions(researchCase) {
  const reliability = researchCase.research_reliability || {};
  const plans = reliability.plans || [];
  const actor = 'dashboard-research-reliability';
  const actions = [
    ['research-reliability-auto-btn', 'reliability-auto', { case_id: researchCase.case_id, actor, max_steps: 12 }],
    ['research-reliability-hypotheses-btn', 'reliability-hypotheses', { case_id: researchCase.case_id, actor }],
    ['research-reliability-rank-btn', 'reliability-rank', { case_id: researchCase.case_id, actor, candidate_budget: 6, comparison_budget: 15, model_call_budget: 0 }],
    ['research-reliability-plan-btn', 'reliability-plan', { case_id: researchCase.case_id, actor, revise: plans.length > 0, reason: plans.length ? 'Evidence, availability, or executed methods changed; preserve a new plan revision.' : 'Initial execution-grounded evidence plan.' }],
    ['research-reliability-scaffold-btn', 'reliability-scaffold', { case_id: researchCase.case_id, actor }],
    ['research-reliability-transition-btn', 'reliability-transition', { case_id: researchCase.case_id, actor }],
    ['research-reliability-full-btn', 'reliability-full', { case_id: researchCase.case_id, actor }],
    ['research-reliability-claims-btn', 'reliability-claims', { case_id: researchCase.case_id, actor, source_kind: 'case_summary', source_locator: researchCase.case_id }],
    ['research-reliability-verify-btn', 'reliability-verify', { case_id: researchCase.case_id, actor }],
    ['research-reliability-clip-btn', 'reliability-clip', { case_id: researchCase.case_id, actor, text: `${researchCase.title || ''}. ${researchCase.summary || ''}`, source_kind: 'case_summary', source_locator: researchCase.case_id }],
    ['research-reliability-specialist-btn', 'reliability-specialist', { case_id: researchCase.case_id, actor }],
    ['research-reliability-blind-btn', 'reliability-blind-review', { case_id: researchCase.case_id, actor }],
    ['research-reliability-completeness-btn', 'reliability-completeness', { case_id: researchCase.case_id, actor }],
    ['research-reliability-originality-btn', 'reliability-originality', { case_id: researchCase.case_id, actor, text: `${researchCase.title || ''}. ${researchCase.summary || ''}` }],
  ];
  actions.forEach(([id, action, payload]) => el(id)?.addEventListener('click', async event => {
    const protectedStages = new Set(['reliability-full', 'reliability-specialist', 'reliability-blind-review']);
    if (protectedStages.has(action) && !(await requestConfirmation(`Run ${statusLabel(action)} for ${researchCase.case_id}?`, {
      title: statusLabel(action),
      context: action === 'reliability-full'
        ? 'This processes approved evidence and imported sandbox results without executing packages or payloads locally.'
        : 'This queues bounded read-only review on the explicitly persisted OpenCodex model. Publication remains human-approved.',
      confirmLabel: 'Continue',
    }))) return;
    await runResearchCaseAction(action, payload, event.currentTarget);
  }));
  el('research-reliability-visual-btn')?.addEventListener('click', async event => {
    const checks = publicationPreviewChecks(researchCase);
    await runResearchCaseAction('reliability-visual', { case_id: researchCase.case_id, actor, ...checks }, event.currentTarget);
  });
  el('research-reliability-adjudicate-btn')?.addEventListener('click', async event => {
    const rationale = String(el('research-adjudication-rationale')?.value || '').trim();
    if (rationale.length < 20) {
      showToast('Add an evidence-backed rationale of at least 20 characters before recording adjudication.', 'error');
      return;
    }
    if (!(await requestConfirmation('Record the human decision for this material review disagreement?', {
      title: 'Adjudicate review disagreement',
      context: 'This changes the publication gate only after you select which evidence-backed review to accept or request more evidence. It does not publish or deploy.',
      confirmLabel: 'Record decision',
    }))) return;
    await runResearchCaseAction('reliability-adjudicate', {
      case_id: researchCase.case_id,
      run_id: event.currentTarget.dataset.runId,
      decision: el('research-adjudication-decision')?.value,
      rationale,
      actor,
    }, event.currentTarget);
  });
  for (const id of ['research-reliability-publish-btn', 'research-reliability-deploy-btn']) {
    el(id)?.addEventListener('click', () => {
      state.blogOps.view = 'review';
      setPage('blog-ops', { routeOverride: BLOG_VIEW_ROUTES.review });
    });
  }
}

function renderResearchCaseDetail(researchCase) {
  const host = el('research-case-detail');
  if (!host) return;
  if (state.researchCases.loading && !researchCase) {
    host.innerHTML = '<div class="empty-state">Loading research case…</div>';
    return;
  }
  if (!researchCase) {
    host.innerHTML = `<div class="empty-state">${escapeHtml(state.researchCases.error || 'Select or create a research case.')}</div>`;
    return;
  }
  const rawReadiness = researchCase.publication_readiness;
  const readiness = rawReadiness && typeof rawReadiness === 'object'
    ? {
      ready: Boolean(rawReadiness.ready),
      blockers: Array.isArray(rawReadiness.blockers) ? rawReadiness.blockers : [],
      warnings: Array.isArray(rawReadiness.warnings) ? rawReadiness.warnings : [],
      checked_at: rawReadiness.checked_at || null,
    }
    : {
      ready: String(rawReadiness || researchCase.publication_readiness_state || '').toLowerCase() === 'ready',
      blockers: [],
      warnings: [],
      checked_at: null,
    };
  const readinessState = String(
    researchCase.publication_readiness_state
      || (readiness.ready ? 'ready' : 'blocked'),
  );
  const subjects = researchCase.subjects || [];
  const artifacts = researchCase.artifacts || [];
  const evidence = researchCase.evidence || [];
  const iocs = researchCase.iocs || [];
  const iocCandidates = researchCase.ioc_candidates || [];
  const legacyIocCandidates = iocCandidates.filter(item => ['pending', 'needs_review'].includes(String(item.status || '').toLowerCase()) && !String(item.classification_reason || '').trim());
  const rules = researchCase.rules || [];
  const ruleProposals = researchCase.rule_proposals || [];
  const findings = researchCase.findings || [];
  const timeline = researchCase.timeline || [];
  const pipeline = (researchCase.pipelines || [])[0] || null;
  const latestReview = (researchCase.publication_reviews || [])[0] || null;
  const nextAction = researchNextActionForCase(researchCase, pipeline, latestReview);
  const calibration = researchCase.assessment_calibration || {};
  const assessment = String(researchCase.assessment || 'unconfirmed_static_lead');
  const evidenceQuality = String(researchCase.evidence_quality || calibration.evidence_quality || 'insufficient');
  const localExposure = String(researchCase.local_exposure || calibration.local_exposure || 'unknown');
  const uniqueObservations = Number(researchCase.unique_observations ?? calibration.unique_observations ?? 0);
  const repeatObservations = Number(researchCase.repeat_observations ?? calibration.repeat_observations ?? 0);
  const decisionFacts = [
    subjects.length ? `${subjects.length} structured subject${subjects.length === 1 ? '' : 's'} recorded.` : 'No structured subject recorded.',
    evidence.length ? `${evidence.length} evidence record${evidence.length === 1 ? '' : 's'} with provenance.` : 'No evidence records attached.',
    artifacts.length ? 'Artifact catalog state is linked to this case.' : 'No artifact catalog record is linked.',
  ];
  const decisionContradictions = [];
  if ((researchCase.state_reconciliation?.changed || []).length) decisionContradictions.push('A subject state was reconciled from the artifact catalog; review the audit event.');
  if (!evidence.some(item => item.evidence_type === 'sandbox_analysis')) decisionContradictions.push('Runtime behavior is unobserved; static evidence must not be described as execution.');
  host.innerHTML = `
    <div class="research-detail-head">
      <div><div class="detail-eyebrow"><code>${escapeHtml(researchCase.case_id)}</code></div><h3>${escapeHtml(researchCase.title)}</h3><p class="small">Updated ${escapeHtml(fmtDate(researchCase.updated_at))} · ${escapeHtml(statusLabel(researchCase.case_type))}</p></div>
      <div class="research-detail-badges">${renderSeverityPill(researchCase.potential_impact || researchCase.severity)}${renderStatusPill(researchCase.status)}</div>
    </div>
    <section class="research-decision-card" aria-label="Case assessment">
      <div class="research-decision-head"><div><span class="detail-eyebrow">CURRENT ASSESSMENT</span><h4>${escapeHtml(humanizeSnake(assessment))}</h4><p>${escapeHtml(researchCase.summary || 'The case is an evidence-led investigation; no automatic maliciousness verdict is implied.')}</p></div><span class="decision-card-badge">${escapeHtml(humanizeSnake(readinessState))}</span></div>
      <div class="research-decision-metrics"><div><span>Detection confidence</span><b>${escapeHtml(String(researchCase.detection_confidence ?? calibration.detection_confidence ?? researchCase.confidence ?? 0))}%</b></div><div><span>Investigation priority</span><b>${escapeHtml(humanizeSnake(researchCase.investigation_priority || calibration.investigation_priority || 'normal'))}</b></div><div><span>Potential impact</span><b>${escapeHtml(humanizeSnake(researchCase.potential_impact || researchCase.severity || 'medium'))}</b></div><div><span>Local exposure</span><b>${escapeHtml(humanizeSnake(localExposure))}</b></div><div><span>Evidence quality</span><b>${escapeHtml(humanizeSnake(evidenceQuality))}</b></div><div><span>Observations</span><b>${escapeHtml(String(uniqueObservations))} unique · ${escapeHtml(String(repeatObservations))} repeated</b></div></div>
      <div class="research-decision-columns"><div><h5>Confirmed facts</h5>${renderBulletList(decisionFacts, 'No confirmed facts recorded.')}</div><div><h5>Contradictions and limits</h5>${renderBulletList(decisionContradictions, 'No contradictions recorded.')}</div><div><h5>Recommended next action</h5><p>${escapeHtml(nextAction.reason)}</p>${legacyIocCandidates.length ? '<button class="secondary-btn mini-btn" id="research-reconcile-btn" type="button">Reconcile legacy indicators</button><div class="small">Classifies older URL candidates as source references or attacker indicators without deleting history.</div>' : ''}</div></div>
    </section>
    <div class="research-readiness ${readiness.ready ? 'ready' : 'blocked'}">
      <strong>${readiness.ready ? 'Publication ready' : `${(readiness.blockers || []).length} publication blocker(s)`}</strong>
      ${renderBulletList(readiness.ready ? (readiness.warnings || []) : (readiness.blockers || []), readiness.ready ? 'No readiness warnings.' : 'Run the readiness workflow before publication.')}
    </div>
    <div class="research-next-action" role="region" aria-labelledby="research-next-action-title">
      <div><span class="detail-eyebrow">NEXT ACTION</span><h4 id="research-next-action-title">${escapeHtml(nextAction.title)}</h4><p>${escapeHtml(nextAction.reason)}</p></div>
      ${nextAction.buttonId ? `<button class="primary-btn" id="research-next-action-btn" data-target="${escapeHtml(nextAction.buttonId)}" type="button">${escapeHtml(nextAction.label)}</button>` : ''}
    </div>
    ${renderExecutionGroundedResearch(researchCase)}
    ${renderResearchAutomationPanel(researchCase)}
    ${researchDetailSection('Case workflow', `
      <div class="research-form-grid">
        <label><span>Status</span><select id="research-detail-status">${['draft','investigating','validation','disclosure_pending','ready_to_publish','published','closed'].map(value => researchOption(value, researchCase.status)).join('')}</select></label>
        <label><span>Disclosure</span><select id="research-detail-disclosure">${['not_started','not_required','preparing','reported','coordinating','disclosed','closed'].map(value => researchOption(value, researchCase.disclosure_status)).join('')}</select></label>
        <label><span>Severity</span><select id="research-detail-severity">${['critical','high','medium','low','info'].map(value => researchOption(value, researchCase.severity)).join('')}</select></label>
        <label><span>Potential impact</span><select id="research-detail-impact">${['critical','high','medium','low','info'].map(value => researchOption(value, researchCase.potential_impact || researchCase.severity || 'medium')).join('')}</select></label>
        <label><span>Confidence</span><input id="research-detail-confidence" type="number" min="0" max="100" value="${escapeHtml(String(researchCase.confidence || 0))}" /></label>
        <label class="research-span-2"><span>Owner</span><input id="research-detail-owner" value="${escapeHtml(researchCase.owner || '')}" maxlength="160" /></label>
        <label class="research-span-2"><span>Executive summary</span><textarea id="research-detail-summary" rows="5" maxlength="8000">${escapeHtml(researchCase.summary || '')}</textarea></label>
      </div><div class="research-form-actions"><button class="primary-btn" id="research-save-case-btn" type="button">Save workflow</button><button class="secondary-btn" id="research-export-btn" type="button">Download case report</button><button class="secondary-btn" id="research-case-gen-pack-btn" data-case-id="${escapeHtml(researchCase.case_id)}" type="button">Generate Social Pack</button></div>`)}
    ${researchDetailSection('Subjects', researchTable(['Type','Subject','Version','Publisher','Lifecycle state'], subjects.map(item => `<tr class="${item.status === 'retracted' ? 'research-row-retracted' : ''}"><td>${escapeHtml(statusLabel(item.subject_type))}</td><td><strong>${escapeHtml(item.ecosystem ? `${item.ecosystem}:${item.name}` : item.name)}</strong></td><td>${escapeHtml(item.version || '—')}</td><td>${escapeHtml(item.publisher || '—')}</td><td><div class="small">Case: ${escapeHtml(statusLabel(item.status))} · Registry: ${escapeHtml(statusLabel(item.registry_state || 'unknown'))} · Artifact: ${escapeHtml(statusLabel(item.artifact_state || 'missing'))} · Validation: ${escapeHtml(statusLabel(item.validation_state || 'unverified'))}</div><details class="research-inline-state"><summary>Update lifecycle state</summary><div class="research-form-grid"><select id="research-subject-registry-${escapeHtml(item.subject_id)}">${['available','unlisted','removed','unavailable','unknown'].map(value => researchOption(value, item.registry_state || 'unknown')).join('')}</select><select id="research-subject-artifact-${escapeHtml(item.subject_id)}">${['collected','missing','externally_supplied'].map(value => researchOption(value, item.artifact_state || 'missing')).join('')}</select><select id="research-subject-validation-${escapeHtml(item.subject_id)}">${['unverified','static_confirmed','sandbox_confirmed'].map(value => researchOption(value, item.validation_state || 'unverified')).join('')}</select><input id="research-subject-reason-${escapeHtml(item.subject_id)}" placeholder="Evidence or reason" /><button class="mini-btn research-subject-state-btn" data-subject-id="${escapeHtml(item.subject_id)}" type="button">Save state</button></div></details> ${researchRetractControl('subject', item)}</td></tr>`), 'No affected subjects recorded.'))}
    ${researchDetailSection('Evidence', researchTable(['Evidence','Type','Provenance','Collected','State'], evidence.map(item => `<tr class="${item.status === 'retracted' ? 'research-row-retracted' : ''}"><td><strong>${escapeHtml(item.title)}</strong><div class="small">${escapeHtml(item.locator || item.sha256 || 'No locator')}</div></td><td>${escapeHtml(statusLabel(item.evidence_type))}</td><td>${escapeHtml(item.provenance || '—')}</td><td>${escapeHtml(fmtDate(item.collected_at))}</td><td>${researchRetractControl('evidence', item)}</td></tr>`), 'No evidence recorded.'))}
    ${researchDetailSection('Indicators', researchTable(['Type','Value','Confidence','Evidence','State'], iocs.map(item => `<tr class="${item.status === 'retracted' ? 'research-row-retracted' : ''}"><td>${escapeHtml(item.ioc_type)}</td><td><code>${escapeHtml(item.value)}</code></td><td>${escapeHtml(String(item.confidence))}</td><td><code>${escapeHtml(item.source_evidence_id || '—')}</code></td><td>${researchRetractControl('ioc', item)}</td></tr>`), 'No indicators recorded; explicitly state when none were found.'))}
    ${researchDetailSection('Detection rules', `
      <div class="research-list-head research-rule-workflow-head"><div><h5>Evidence-linked detections</h5><p class="small">Generate deterministic proposals from reviewed suspect artifacts and high-confidence IOCs. Reference artifacts and low-confidence indicators are excluded.</p></div><button class="primary-btn" id="research-rule-propose-btn" type="button">Generate detection proposals</button></div>
      <h5>Awaiting review</h5>
      ${researchTable(['Type','Proposal','Validation','Evidence','Decision'], ruleProposals.filter(item => item.status === 'review_required').map(item => `<tr><td>${escapeHtml(String(item.rule_type || '').toUpperCase())}</td><td><strong>${escapeHtml(item.name)}</strong><div class="small">${escapeHtml(item.purpose || '')}</div><pre class="research-rule-preview"><code>${escapeHtml(compactText(item.content || '', 420))}</code></pre></td><td>${renderStatusPill(item.validation_status || item.validation?.status || 'unknown')}${(item.test?.execution?.limitations || []).length ? `<div class="small">${escapeHtml((item.test.execution.limitations || []).join(' '))}</div>` : ''}</td><td><code>${escapeHtml(item.source_evidence_id || '—')}</code></td><td><div class="research-rule-review-actions"><button class="mini-btn primary-btn research-rule-review-btn" data-proposal-id="${escapeHtml(item.proposal_id)}" data-decision="accepted" type="button">Activate</button><button class="mini-btn secondary-btn research-rule-review-btn" data-proposal-id="${escapeHtml(item.proposal_id)}" data-decision="rejected" type="button">Reject</button></div></td></tr>`), 'No proposals await review. Generate proposals after collecting reviewed evidence.')}
      <h5>Active case-linked rules</h5>
      ${researchTable(['Type','Rule','Validation','Evidence','State'], rules.map(item => `<tr class="${item.status === 'retracted' ? 'research-row-retracted' : ''}"><td>${escapeHtml(String(item.rule_type || '').toUpperCase())}</td><td><strong>${escapeHtml(item.name)}</strong>${item.purpose ? `<div class="small">${escapeHtml(item.purpose)}</div>` : ''}<pre class="research-rule-preview"><code>${escapeHtml(compactText(item.content || '', 420))}</code></pre></td><td>${escapeHtml(statusLabel(item.validation_status || item.validation?.status || 'unknown'))}</td><td><code>${escapeHtml(item.source_evidence_id || '—')}</code></td><td>${researchRetractControl('rule', item)}</td></tr>`), 'No active case-linked rules. Valid proposals appear above before activation.')}
      ${ruleProposals.some(item => ['accepted','rejected','failed_validation'].includes(item.status)) ? `<details class="research-rule-history"><summary>Proposal history (${ruleProposals.filter(item => item.status !== 'review_required').length})</summary>${researchTable(['Type','Proposal','State','Reviewer'], ruleProposals.filter(item => item.status !== 'review_required').map(item => `<tr><td>${escapeHtml(String(item.rule_type || '').toUpperCase())}</td><td><strong>${escapeHtml(item.name)}</strong></td><td>${renderStatusPill(item.status)}</td><td>${escapeHtml(item.reviewer || '—')}</td></tr>`), 'No reviewed proposals.')}</details>` : ''}
    `)}
    ${researchDetailSection('Linked findings', researchTable(['Finding','Relationship','Linked'], findings.map(item => `<tr><td><code>${escapeHtml(item.finding_id)}</code></td><td>${escapeHtml(statusLabel(item.relationship))}</td><td>${escapeHtml(fmtDate(item.created_at))}</td></tr>`), 'No SOC findings linked.'))}
    <details class="research-action-drawer"><summary>Add subject</summary><div class="research-form-grid"><label><span>Type</span><select id="research-subject-type">${['package','extension','repository','publisher','brand','infrastructure','other'].map(value => researchOption(value, 'package')).join('')}</select></label><label><span>Ecosystem</span><input id="research-subject-ecosystem" placeholder="npm, pypi, nuget" /></label><label class="research-span-2"><span>Name</span><input id="research-subject-name" placeholder="Package, brand, repository, or infrastructure" /></label><label><span>Version</span><input id="research-subject-version" /></label><label><span>Publisher</span><input id="research-subject-publisher" /></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-add-subject-btn" type="button">Add subject</button></div></details>
    <details class="research-action-drawer"><summary>Add evidence</summary><div class="research-form-grid"><label><span>Type</span><select id="research-evidence-type">${['source','registry_metadata','package_artifact','static_analysis','sandbox_analysis','screenshot','analyst_note','other'].map(value => researchOption(value, 'source')).join('')}</select></label><label><span>Title</span><input id="research-evidence-title" /></label><label class="research-span-2"><span>Locator</span><input id="research-evidence-locator" placeholder="Public URL or controlled local reference" /></label><label class="research-span-2"><span>SHA-256</span><input id="research-evidence-sha256" maxlength="64" /></label><label><span>Provenance</span><input id="research-evidence-provenance" /></label><label><span>Visual viewport</span><select id="research-evidence-visual-viewport"><option value="">Not a visual-QA screenshot</option><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select></label><label><span>Alt text</span><input id="research-evidence-alt-text" maxlength="1000" placeholder="Describe the image for accessibility" /></label><label><span>License</span><input id="research-evidence-license" maxlength="500" placeholder="Source-approved, CC BY, or other permission" /></label><label class="research-span-2"><span>Source attribution</span><input id="research-evidence-source-attribution" maxlength="1000" placeholder="Publisher, author, and source URL or permission note" /></label><label class="research-span-2"><span>Notes</span><textarea id="research-evidence-notes" rows="3"></textarea></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-add-evidence-btn" type="button">Add evidence</button></div></details>
    <details class="research-action-drawer"><summary>Add IOC</summary><div class="research-form-grid"><label><span>Type</span><select id="research-ioc-type">${['domain','url','ipv4','ipv6','sha256','sha1','md5','email','wallet','file_path','other'].map(value => researchOption(value, 'domain')).join('')}</select></label><label><span>Confidence</span><input id="research-ioc-confidence" type="number" min="0" max="100" value="50" /></label><label class="research-span-2"><span>Value</span><input id="research-ioc-value" /></label><label><span>Source evidence</span><select id="research-ioc-evidence"><option value="">Not linked</option>${evidence.map(item => `<option value="${escapeHtml(item.evidence_id)}">${escapeHtml(item.title)}</option>`).join('')}</select></label><label><span>Tags</span><input id="research-ioc-tags" placeholder="credential-theft, skimmer" /></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-add-ioc-btn" type="button">Add IOC</button></div></details>
    <details class="research-action-drawer"><summary>Advanced: add a rule manually</summary><p class="small">Use this only for an independently reviewed rule. Rules are stored as research artifacts and structurally checked. SecOpsAI never executes submitted rule content.</p><div class="research-form-grid"><label><span>Type</span><select id="research-rule-type">${['yara','sigma','semgrep'].map(value => researchOption(value, 'sigma')).join('')}</select></label><label><span>Name</span><input id="research-rule-name" maxlength="240" placeholder="suspicious-package-execution" /></label><label><span>Source evidence</span><select id="research-rule-evidence"><option value="">Not linked</option>${evidence.map(item => `<option value="${escapeHtml(item.evidence_id)}">${escapeHtml(item.title)}</option>`).join('')}</select></label><label class="research-span-2"><span>Purpose</span><input id="research-rule-purpose" maxlength="2000" placeholder="What defensive behavior does this rule detect?" /></label><label class="research-span-2"><span>Rule content</span><textarea id="research-rule-content" rows="12" maxlength="524288" spellcheck="false" placeholder="Paste a YARA, Sigma, or Semgrep rule"></textarea></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-add-rule-btn" type="button">Add reviewed rule</button></div></details>
    <details class="research-action-drawer"><summary>Link finding or add note</summary><div class="research-form-grid"><label><span>Finding ID</span><input id="research-link-finding-id" placeholder="SCM-... or EDGE-..." /></label><label><span>Relationship</span><select id="research-link-relationship">${['supports','related','derived_from','impacts'].map(value => researchOption(value, 'supports')).join('')}</select></label><label class="research-span-2"><span>Analyst note</span><textarea id="research-note-text" rows="3"></textarea></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-link-finding-btn" type="button">Link finding</button><button class="secondary-btn" id="research-add-note-btn" type="button">Add note</button></div></details>
    ${researchDetailSection('Timeline', timeline.length ? `<div class="feed">${timeline.slice().reverse().slice(0, 50).map(item => `<div class="feed-item"><strong>${escapeHtml(statusLabel(item.event_type))}</strong><div>${escapeHtml(item.message)}</div><div class="meta">${escapeHtml(item.actor)} · ${escapeHtml(fmtDate(item.created_at))}</div></div>`).join('')}</div>` : '<div class="empty-state compact">No case activity recorded.</div>')}
    ${state.researchCases.lastAction?.error ? `<div class="error">${escapeHtml(state.researchCases.lastAction.error)}</div>` : ''}
  `;
  bindResearchCaseDetailActions(researchCase);
  el('research-next-action-btn')?.addEventListener('click', () => {
    const target = el(el('research-next-action-btn').dataset.target);
    target?.click();
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function researchNextActionForCase(researchCase, pipeline, review) {
  const reliabilityNext = researchCase.research_reliability?.next_action;
  if (reliabilityNext?.action) {
    const targetByAction = {
      generate_hypotheses: 'research-reliability-hypotheses-btn',
      rank_hypotheses: 'research-reliability-rank-btn',
      create_plan: 'research-reliability-plan-btn',
      run_scaffold: 'research-reliability-scaffold-btn',
      verify_transition: 'research-reliability-transition-btn',
      run_full: 'research-reliability-full-btn',
      build_claim_ledger: 'research-reliability-claims-btn',
      verify_claims: 'research-reliability-verify-btn',
      queue_specialist: 'research-reliability-specialist-btn',
      adjudicate_review: 'research-reliability-adjudicate-btn',
      audit_completeness: 'research-reliability-completeness-btn',
      audit_originality: 'research-reliability-originality-btn',
      visual_qa: 'research-reliability-visual-btn',
      publication_review: 'research-publication-check-btn',
    };
    return {
      title: reliabilityNext.label || humanizeSnake(reliabilityNext.action),
      label: reliabilityNext.label || humanizeSnake(reliabilityNext.action),
      buttonId: targetByAction[reliabilityNext.action] || 'research-reliability-hypotheses-btn',
      reason: reliabilityNext.reason || 'Complete the next execution-grounded reliability stage.',
    };
  }
  if (!pipeline) return { title: 'Start evidence collection', label: 'Run investigation pipeline', buttonId: 'research-pipeline-start-btn', reason: 'Collect normalized package metadata, compare the reference, and prepare evidence-linked review items.' };
  const operational = researchPipelineOperationalState(pipeline);
  if (['stalled', 'blocked'].includes(operational.state)) return { title: 'Restore model analysis', label: 'Open Automation', buttonId: 'research-pipeline-open-automation-btn', reason: operational.message };
  if (pipeline.status === 'awaiting_review') return { title: 'Review agent proposals', label: 'Complete guarded agent review', buttonId: 'research-pipeline-auto-review-btn', reason: 'The pipeline has prepared bounded evidence and an evidence-linked verdict. Review the proposed conclusions before attaching them.' };
  if (pipeline.status === 'awaiting_input' || pipeline.status === 'failed') return { title: 'Resolve the pipeline blocker', label: pipeline.status === 'failed' ? 'Retry from checkpoint' : 'Add reference and rerun analysis', buttonId: 'research-pipeline-resume-btn', reason: pipeline.error_message || 'The pipeline needs an approved reference package or a retry from its last safe checkpoint.' };
  if (!review) return { title: 'Generate publication safety review', label: 'Run publication safety check', buttonId: 'research-publication-check-btn', reason: 'Check confidence, evidence completeness, disclosure state, and unsafe disclosure details before drafting public content.' };
  if (!['reported', 'coordinating', 'disclosed', 'closed', 'not_required'].includes(String(researchCase.disclosure_status || '').toLowerCase())) return { title: 'Prepare responsible disclosure', label: 'Prepare disclosure', buttonId: 'research-disclosure-btn', reason: 'Create a review-only disclosure draft. Sending it remains a separate approval-gated action.' };
  if (researchCase.status === 'ready_to_publish' && review.status === 'approved') return { title: 'Create the editorial draft', label: 'Create review draft', buttonId: 'research-draft-blog-btn', reason: 'The case has passed its recorded gates. The draft will remain in Blog Ops for final human approval.' };
  return { title: 'Review the case evidence', label: 'Open evidence matrix', buttonId: 'research-matrix-btn', reason: 'Read the claim-to-evidence mapping and confirm that the current verdict is supported.' };
}

function renderResearchCases() {
  const tokenInput = el('research-cases-admin-token');
  if (tokenInput && tokenInput.value !== state.researchCases.adminToken) tokenInput.value = state.researchCases.adminToken;
  const cases = state.researchCases.cases || [];
  const researchView = state.researchCases.view || 'cases';
  const researchViewCopy = {
    inbox: ['Discovery inbox', 'Review ranked candidates and decide which leads should become durable investigations.'],
    cases: ['Research cases', 'Track evidence, analysis, disclosure, publication, and monitoring for each investigation.'],
    campaigns: ['Campaigns', 'Review related packages, publishers, dependencies, infrastructure, and timelines without inferring attribution.'],
    watchlists: ['Watchlists', 'Manage monitored packages, brands, publishers, and namespaces across supported ecosystems.'],
    disclosure: ['Disclosure', 'Review disclosure state, deadlines, and external communication gates for selected cases.'],
    sandbox: ['Sandbox jobs', 'Review approval-gated dynamic analysis requests and imported results.'],
    resolved: ['Resolved by agents', 'Review reversible case resolutions and reopen any decision that needs human investigation.']
  }[researchView] || ['Research cases', 'Track evidence, analysis, disclosure, publication, and monitoring for each investigation.'];
  const viewSummary = el('research-view-summary');
  if (viewSummary) viewSummary.innerHTML = `<span class="eyebrow">Research workspace</span><strong>${escapeHtml(researchViewCopy[0])}</strong><span>${escapeHtml(researchViewCopy[1])}</span>`;
  const page = el('page-research-cases');
  if (page) page.dataset.researchView = researchView;
  document.querySelectorAll('#page-research-cases [data-research-section]').forEach(section => {
    const allowed = String(section.dataset.researchSection || '').split(/\s+/).filter(Boolean);
    section.hidden = !allowed.includes(researchView);
  });
  const ready = cases.filter(item => item.status === 'ready_to_publish').length;
  const active = cases.filter(item => !['published', 'closed'].includes(item.status)).length;
  const disclosure = cases.filter(item => ['disclosure_pending'].includes(item.status) || ['reported', 'coordinating'].includes(item.disclosure_status)).length;
  const evidence = cases.reduce((sum, item) => sum + Number(item.evidence_count || 0), 0);
  const rules = cases.reduce((sum, item) => sum + Number(item.rule_count || 0), 0);
  const ruleProposals = cases.reduce((sum, item) => sum + Number(item.rule_proposal_count || 0), 0);
  const stats = el('research-cases-stats');
  if (stats) stats.innerHTML = [
    edgeMetric('Active cases', active, `${cases.length} total`),
    edgeMetric('Ready to publish', ready, 'Disclosure checks passed'),
    edgeMetric('Coordinating', disclosure, 'Disclosure in progress'),
    edgeMetric('Evidence records', evidence, 'Structured provenance'),
    edgeMetric('IOC records', cases.reduce((sum, item) => sum + Number(item.ioc_count || 0), 0), 'Normalized indicators'),
    edgeMetric('Case-linked rules', rules, `${ruleProposals} awaiting review · YARA, Sigma, Semgrep`)
  ].join('');
  renderResearchWatchlist();
  renderResearchDiscovery();
  renderResearchResolutions();
  renderResearchStageQueues(state.researchCases.discovery.candidates || []);
  const list = el('research-case-list');
  const filtered = filteredResearchCases();
  if (list) list.innerHTML = state.researchCases.loading && !cases.length
    ? '<div class="empty-state">Loading research cases…</div>'
    : filtered.length
      ? `<div class="small research-case-list-note">Severity is investigation priority, not a maliciousness verdict. Use assessment, evidence quality, and local exposure to decide what is proven.</div><div class="research-case-list">${filtered.map(item => { const assessment = humanizeSnake(item.assessment || 'unconfirmed_static_lead'); const evidenceQuality = humanizeSnake(item.evidence_quality || 'insufficient'); const localExposure = humanizeSnake(item.local_exposure || 'unknown'); return `<button class="research-case-row ${item.case_id === state.researchCases.selectedId ? 'selected' : ''}" type="button" data-research-case-id="${escapeHtml(item.case_id)}"><span class="research-case-row-head"><strong>${escapeHtml(item.title)}</strong>${renderSeverityPill(item.potential_impact || item.severity)}</span><span class="small"><code>${escapeHtml(item.case_id)}</code> · ${escapeHtml(statusLabel(item.status))} · confidence ${escapeHtml(String(item.confidence || 0))}</span><span class="small">Assessment: ${escapeHtml(assessment)} · evidence: ${escapeHtml(evidenceQuality)} · exposure: ${escapeHtml(localExposure)}</span><span class="small">${escapeHtml(String(item.evidence_count || 0))} evidence · ${escapeHtml(String(item.ioc_count || 0))} IOCs · ${escapeHtml(fmtDate(item.updated_at))}</span></button>`; }).join('')}</div>`
      : `<div class="empty-state">${escapeHtml(state.researchCases.error || 'No research cases match this view.')}</div>`;
  list?.querySelectorAll('[data-research-case-id]').forEach(button => button.addEventListener('click', async () => {
    state.researchCases.selectedId = button.dataset.researchCaseId;
    state.researchCases.loading = true;
    renderResearchCases();
    try {
      await loadResearchCaseDetail(state.researchCases.selectedId, { render: false });
      state.researchCases.error = null;
    } catch (error) {
      state.researchCases.error = error?.message || String(error);
    } finally {
      state.researchCases.loading = false;
      renderResearchCases();
    }
  }));
  renderResearchCaseDetail(state.researchCases.selected);
  syncResearchPipelinePolling();
}

function renderResearchResolutions() {
  const host = el('research-agent-resolution');
  if (!host) return;
  const resolution = state.researchCases.resolution || {};
  const settings = resolution.settings || {};
  const summary = resolution.summary || {};
  const runs = Array.isArray(resolution.runs) ? resolution.runs : [];
  host.innerHTML = `
    <div class="module-head"><div><h3>Agent resolution policy</h3><p>Models may close only evidence-complete, reversible benign or not-substantiated cases. Likely or confirmed threats are escalated. Publication, disclosure, rule activation, and destructive response remain human-approved.</p></div>${renderStatusPill(settings.mode === 'guarded' ? 'completed' : settings.mode === 'off' ? 'blocked' : 'in_review', settings.mode || 'advisory')}</div>
    <div class="grid cols-4">
      ${edgeMetric('Awaiting review', summary.awaiting_review || 0, 'Applied or recommended')}
      ${edgeMetric('Applied', summary.applied || 0, 'Reversible closures')}
      ${edgeMetric('Blocked', summary.blocked || 0, 'Guardrails prevented action')}
      ${edgeMetric('Rolled back', summary.rolled_back || 0, 'Reopened by an operator')}
    </div>
    <div class="research-form-grid" style="margin-top:18px;">
      <label><span>Mode</span><select id="research-resolution-mode">${['off','advisory','guarded'].map(value => researchOption(value, settings.mode || 'advisory')).join('')}</select></label>
      <label><span>Minimum confidence</span><input id="research-resolution-confidence" type="number" min="85" max="100" value="${escapeHtml(String(settings.min_confidence || 90))}" /></label>
      <label><span>Minimum evidence references</span><input id="research-resolution-evidence" type="number" min="2" max="20" value="${escapeHtml(String(settings.min_evidence_refs || 4))}" /></label>
      <label><span>Cases per cycle</span><input id="research-resolution-limit" type="number" min="1" max="100" value="${escapeHtml(String(settings.max_cases_per_cycle || 10))}" /></label>
      <label class="checkbox-row"><input id="research-resolution-retract-rules" type="checkbox" ${settings.auto_retract_rules !== false ? 'checked' : ''} /><span>Retract active rules when a case closes</span></label>
    </div>
    <div class="research-form-actions"><button class="primary-btn" id="research-resolution-save-btn" type="button">Save policy</button><button class="secondary-btn" id="research-resolution-current-btn" type="button" ${state.researchCases.selected?.pipelines?.[0]?.pipeline_id ? '' : 'disabled'}>Evaluate selected case</button><button class="secondary-btn" id="research-resolution-open-automation-btn" type="button">Review all finding and alert decisions</button></div>
    <h4 style="margin-top:20px;">Resolution review queue</h4>
    ${runs.length ? researchTable(['Case','Verdict','Decision','Guardrails','Updated','Review'], runs.map(run => {
      const reasons = run.decision?.guardrail_reasons || [];
      const reviewable = ['applied','recommended'].includes(run.status);
      return `<tr><td><strong>${escapeHtml(run.case_id)}</strong><div class="small"><code>${escapeHtml(run.run_id)}</code></div></td><td>${escapeHtml(statusLabel(run.verdict))}<div class="small">${escapeHtml(String(run.confidence))}% confidence</div></td><td>${renderStatusPill(run.status)}</td><td>${reasons.length ? escapeHtml(humanizeMachineText(reasons.join('; '))) : 'Passed all closure gates'}</td><td>${escapeHtml(fmtDate(run.updated_at))}</td><td>${reviewable ? `<div class="research-rule-review-actions"><button class="mini-btn primary-btn research-resolution-review-btn" data-run-id="${escapeHtml(run.run_id)}" data-decision="accept" type="button">Accept</button><button class="mini-btn secondary-btn research-resolution-review-btn" data-run-id="${escapeHtml(run.run_id)}" data-decision="reopen" type="button">Reopen</button></div>` : escapeHtml(statusLabel(run.status))}</td></tr>`;
    }), 'No agent case resolutions yet.') : '<div class="empty-state compact">No agent case resolutions yet. Completed pipelines appear here after the configured policy evaluates them.</div>'}
  `;
  el('research-resolution-save-btn')?.addEventListener('click', event => runResearchCaseAction('resolution-configure', {
    mode: el('research-resolution-mode')?.value || 'advisory',
    min_confidence: Number(el('research-resolution-confidence')?.value || 90),
    min_evidence_refs: Number(el('research-resolution-evidence')?.value || 4),
    max_cases_per_cycle: Number(el('research-resolution-limit')?.value || 10),
    auto_retract_rules: Boolean(el('research-resolution-retract-rules')?.checked),
  }, event.currentTarget));
  el('research-resolution-current-btn')?.addEventListener('click', event => runResearchCaseAction('resolution-run', {
    pipeline_id: state.researchCases.selected?.pipelines?.[0]?.pipeline_id || '',
  }, event.currentTarget));
  el('research-resolution-open-automation-btn')?.addEventListener('click', () => setPage('automation'));
  host.querySelectorAll('.research-resolution-review-btn').forEach(button => button.addEventListener('click', async event => {
    const decision = button.dataset.decision;
    if (!(await requestConfirmation(decision === 'reopen' ? 'Reopen this agent-resolved case for analyst review?' : 'Accept this agent resolution?', {
      title: decision === 'reopen' ? 'Reopen case' : 'Accept agent resolution',
      context: decision === 'reopen' ? 'The previous case fields and validation-passed rules will be restored.' : 'The closure remains auditable and no publication or external action occurs.',
      confirmLabel: decision === 'reopen' ? 'Reopen' : 'Accept'
    }))) return;
    await runResearchCaseAction('resolution-review', { run_id: button.dataset.runId, decision }, event.currentTarget);
  }));
}

function syncResearchPipelinePolling() {
  const pipeline = (state.researchCases.selected?.pipelines || [])[0];
  const operational = researchPipelineOperationalState(pipeline);
  const shouldPoll = pipeline
    && ['running', 'awaiting_ai'].includes(pipeline.status)
    && operational.state !== 'stalled';
  if (!shouldPoll) {
    if (state.researchPipelinePollTimer) clearTimeout(state.researchPipelinePollTimer);
    state.researchPipelinePollTimer = null;
    return;
  }
  if (state.researchPipelinePollTimer) return;
  const delay = operational.pollMs || 30000;
  state.researchPipelinePollTimer = setTimeout(async () => {
    const caseId = state.researchCases.selectedId;
    if (!caseId) {
      state.researchPipelinePollTimer = null;
      return;
    }
    try {
      await loadResearchCaseDetail(caseId, { render: false });
      renderResearchCases();
    } catch (error) {
      console.warn('research pipeline refresh failed', error);
    } finally {
      state.researchPipelinePollTimer = null;
      syncResearchPipelinePolling();
    }
  }, delay);
}

async function loadIntegrationStatus() {
  try {
    const res = await dashboardApiFetch(cfg.integrationStatusEndpoint || '/api/integration-status');
    if (!res.ok) throw new Error(`Integration status HTTP ${res.status}`);
    state.integrationStatus = await res.json();
  } catch (error) {
    console.error('integration status load failed', error);
    state.integrationStatus = {
      ok: false,
      helper: {
        mode: 'local-control-panel',
        run_output_api: false,
        secopsai_triage_api: false,
        secopsai_sessions_api: false,
        secopsai_research_api: false,
        secopsai_campaign_api: false,
        secopsai_events_api: false,
        secopsai_edge_api: false,
        secopsai_intelligence_api: false,
        secopsai_specialists_api: false
      },
      ai_guard: aiGuardConfig()
    };
  }
}

async function loadEnterpriseStatus({ render = true } = {}) {
  state.enterprise.loading = true;
  if (render) renderEnterprise();
  try {
    const response = await dashboardApiFetch('/api/secopsai/enterprise-status');
    const payload = await response.json().catch(() => ({}));
    state.enterprise.data = payload;
    state.enterprise.error = response.ok ? null : (payload.error || `Enterprise status HTTP ${response.status}`);
  } catch (error) {
    state.enterprise.error = error?.message || String(error);
    state.enterprise.data = { ok: false, error: state.enterprise.error };
  } finally {
    state.enterprise.loading = false;
    if (render) renderEnterprise();
  }
  return state.enterprise.data;
}

function enterpriseStatusResult() {
  const data = state.enterprise.data || {};
  return data.result || data;
}

function enterpriseSummaryData() {
  const result = enterpriseStatusResult();
  return result.summary && typeof result.summary === 'object' ? result.summary : {};
}

function enterpriseCount(name) {
  return Number(enterpriseSummaryData().counts?.[name] || 0);
}

function enterpriseTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (['ready', 'active', 'healthy', 'complete', 'implemented', 'allow'].includes(normalized)) return 'good';
  if (['degraded', 'failed', 'critical', 'deny', 'error'].includes(normalized)) return 'danger';
  if (['configured', 'attention', 'needs_review', 'high', 'pending'].includes(normalized)) return 'warning';
  return 'neutral';
}

function enterpriseReadinessItem(label, value, detail, tone = 'neutral') {
  return `<div class="enterprise-readiness-item tone-${escapeHtml(tone)}"><span class="enterprise-readiness-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

function enterpriseSourceGroupState(sourceNames, sources, events) {
  const cursors = sources.filter(item => sourceNames.includes(String(item.source || '')));
  const recent = events.filter(item => sourceNames.includes(String(item.source || '')));
  if (cursors.some(item => String(item.status || '').toLowerCase() === 'degraded')) {
    const latest = cursors.find(item => String(item.status || '').toLowerCase() === 'degraded') || {};
    return { label: 'Attention', tone: 'danger', detail: latest.last_error_at ? `Last error ${fmtDate(latest.last_error_at)}` : 'Latest connector attempt failed' };
  }
  if (cursors.length && recent.length) {
    const latest = sortLatestFirst(recent, ['received_at', 'observed_at'])[0] || {};
    return { label: 'Active', tone: 'good', detail: `${recent.length} recent event${recent.length === 1 ? '' : 's'}${latest.received_at ? `, last ${fmtDate(latest.received_at)}` : ''}` };
  }
  if (cursors.length) {
    const latest = sortLatestFirst(cursors, ['last_success_at', 'updated_at'])[0] || {};
    return { label: 'Configured', tone: 'warning', detail: latest.last_success_at ? `Connected ${fmtDate(latest.last_success_at)}; no recent events` : 'Connector cursor exists; no recent events' };
  }
  return { label: 'Implemented', tone: 'neutral', detail: 'Parser is available; no source has been connected or imported' };
}

function enterpriseResultMarkup(output) {
  if (!output) return '';
  const details = Array.isArray(output.details) ? output.details.filter(Boolean) : [];
  return `<div class="enterprise-result-card tone-${escapeHtml(output.tone || 'neutral')}">
    <strong>${escapeHtml(output.title || 'Action complete')}</strong>
    <p>${escapeHtml(output.summary || '')}</p>
    ${details.length ? `<ul>${details.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function setEnterpriseOutput(outputId, output) {
  state.enterprise.outputs[outputId] = output;
  const target = el(outputId);
  if (target) target.innerHTML = enterpriseResultMarkup(output);
}

function enterpriseActionOutput(action, payload) {
  const result = payload?.result || payload || {};
  if (action === 'ingest-events') {
    const events = Array.isArray(result.events) ? result.events : [];
    return {
      tone: result.status === 'healthy' ? 'good' : 'danger',
      title: result.status === 'healthy' ? 'Telemetry imported' : 'Telemetry import needs attention',
      summary: `${events.length} event${events.length === 1 ? '' : 's'} normalized from ${result.source || 'the approved source'}.`,
      details: result.error ? [result.error] : ['Credential-shaped fields are redacted before storage.', 'The source cursor and last successful import were recorded.']
    };
  }
  if (action === 'kubernetes-scan') {
    const findings = Array.isArray(result.findings) ? result.findings : [];
    return {
      tone: result.admission === 'deny' ? 'danger' : 'good',
      title: result.admission === 'deny' ? 'Manifest would be blocked' : 'Manifest passed the dry-run gate',
      summary: `${findings.length} deterministic posture finding${findings.length === 1 ? '' : 's'}; no cluster mutation was performed.`,
      details: findings.slice(0, 8).map(item => `${String(item.severity || 'info').toUpperCase()} ${item.rule_id || 'rule'}: ${item.message || 'Review required'}`)
    };
  }
  if (action === 'dast-validate') {
    return {
      tone: 'good',
      title: 'DAST scope validated',
      summary: `${humanizeSnake(result.mode || 'passive')} plan prepared for ${result.target?.url || 'the authorized target'}; no scan was launched.`,
      details: ['Target ownership and authorization were recorded.', 'Execution remains not started until an approved runner launches the plan.']
    };
  }
  if (action === 'prioritize-vulnerability') {
    return {
      tone: ['critical', 'high'].includes(String(result.priority_severity || '').toLowerCase()) ? 'danger' : 'warning',
      title: `${humanizeSnake(result.priority_severity || 'review')} priority - score ${result.priority_score ?? 0}`,
      summary: `${result.advisory_id || 'Advisory'} on ${result.package_name || 'the selected product'} was normalized, scored, and saved.`,
      details: [...(result.priority_reasons || []), result.sla_due_at ? `Remediation SLA due ${fmtDate(result.sla_due_at)}` : '']
    };
  }
  if (action === 'control') {
    return { tone: 'good', title: 'Control saved', summary: `${result.control_id || 'Control'} is ${humanizeSnake(result.status || 'saved')} and owned by ${result.owner || 'the selected owner'}.`, details: [humanizeSnake(result.framework || '')] };
  }
  if (action === 'workflow') {
    return { tone: 'good', title: 'Draft workflow created', summary: `${result.title || result.payload?.title || 'Workflow'} is saved as an evidence-linked draft.`, details: ['External submission and active testing remain approval-gated.'] };
  }
  return { tone: 'good', title: 'Enterprise action completed', summary: 'The protected helper accepted and completed the action.', details: [] };
}

function renderEnterprise() {
  const data = state.enterprise.data || {};
  const result = enterpriseStatusResult();
  const store = result.store || {};
  const status = enterpriseSummaryData();
  const counts = status.counts || {};
  const sources = Array.isArray(status.sources) ? status.sources : [];
  const events = sortLatestFirst(Array.isArray(status.recent_events) ? status.recent_events : [], ['received_at', 'observed_at']);
  const vulnerabilities = sortLatestFirst(Array.isArray(status.recent_vulnerabilities) ? status.recent_vulnerabilities : [], ['updated_at']);
  const controls = sortLatestFirst(Array.isArray(status.recent_controls) ? status.recent_controls : [], ['updated_at']);
  const workflows = sortLatestFirst(Array.isArray(status.recent_workflows) ? status.recent_workflows : [], ['updated_at']);
  const configured = Boolean(data.ok !== false && store.status === 'ready');
  const activeSources = sources.filter(item => String(item.status || '').toLowerCase() === 'healthy').length;
  const degradedSources = sources.filter(item => String(item.status || '').toLowerCase() === 'degraded').length;
  const assuranceCount = Number(counts.controls || 0) + Number(counts.questionnaires || 0) + Number(counts.threat_models || 0) + Number(counts.pentests || 0);

  const summary = el('enterprise-summary');
  if (summary) summary.innerHTML = [
    enterpriseReadinessItem('Data plane', configured ? 'Ready' : 'Unavailable', configured ? `${humanizeSnake(store.backend || 'local')} store, organization ${store.organization_id || 'local'}` : 'Start the helper or configure the hosted Core endpoint', configured ? 'good' : 'danger'),
    enterpriseReadinessItem('Telemetry', activeSources ? `${activeSources} connected` : 'Not connected', degradedSources ? `${degradedSources} source${degradedSources === 1 ? '' : 's'} need attention` : `${Number(counts.events || 0)} normalized event${Number(counts.events || 0) === 1 ? '' : 's'}`, degradedSources ? 'danger' : activeSources ? 'good' : 'neutral'),
    enterpriseReadinessItem('Exposure', Number(counts.open_vulnerabilities || 0) ? `${counts.open_vulnerabilities} open` : 'No records', Number(counts.vulnerabilities || 0) ? `${counts.vulnerabilities} prioritized vulnerabilities` : 'Run an assessment to establish a baseline', Number(counts.open_vulnerabilities || 0) ? 'warning' : 'neutral'),
    enterpriseReadinessItem('Assurance', assuranceCount ? `${assuranceCount} records` : 'Not started', `${Number(counts.controls || 0)} controls, ${workflows.length} recent workflows`, assuranceCount ? 'good' : 'neutral')
  ].join('');

  const refreshed = el('enterprise-refreshed');
  if (refreshed) refreshed.textContent = state.enterprise.loading ? 'Refreshing operational evidence...' : status.generated_at ? `Evidence refreshed ${fmtDate(status.generated_at)}` : 'No operational evidence loaded';

  document.querySelectorAll('[data-enterprise-tab]').forEach(button => {
    const selected = button.dataset.enterpriseTab === state.enterprise.activeTab;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  document.querySelectorAll('[data-enterprise-view]').forEach(view => {
    const selected = view.dataset.enterpriseView === state.enterprise.activeTab;
    view.classList.toggle('active', selected);
    view.hidden = !selected;
  });
  document.querySelectorAll('[data-enterprise-assessment]').forEach(button => button.classList.toggle('active', button.dataset.enterpriseAssessment === state.enterprise.activeAssessment));
  document.querySelectorAll('[data-enterprise-assessment-view]').forEach(view => {
    const selected = view.dataset.enterpriseAssessmentView === state.enterprise.activeAssessment;
    view.classList.toggle('active', selected);
    view.hidden = !selected;
  });

  const note = el('enterprise-safety-note');
  if (note) {
    note.className = `enterprise-safety ${state.enterprise.error ? 'tone-danger' : configured ? 'tone-good' : 'tone-warning'}`;
    note.textContent = state.enterprise.error
      ? `Enterprise status unavailable: ${state.enterprise.error}. Hosted mode needs a configured helper; local actions require the local dashboard stack.`
      : 'Live truth: implemented means the capability exists, configured means a cursor or record exists, and active means recent evidence was received. Cloud changes, active scans, disclosure, and publication remain approval-gated.';
  }

  const setupTitle = el('enterprise-setup-title');
  const setupSummary = el('enterprise-setup-summary');
  const setupButton = el('enterprise-configure-source-btn');
  if (setupTitle) setupTitle.textContent = !configured ? 'Connect the Enterprise data plane' : !sources.length ? 'Import your first approved telemetry source' : !events.length ? 'Your sources are configured; add current evidence' : 'Enterprise monitoring is receiving evidence';
  if (setupSummary) setupSummary.textContent = !configured ? 'Start the local helper or configure the hosted Core endpoint before using Enterprise workflows.' : !sources.length ? 'Choose AWS, GCP, or Kubernetes and import an approved event. Credentials stay out of the browser.' : !events.length ? 'The connector cursor exists, but no recent normalized events are available yet.' : `${events.length} recent event${events.length === 1 ? '' : 's'} are ready for operator review.`;
  if (setupButton) setupButton.textContent = !configured ? 'Open system health' : !sources.length ? 'Import first source' : 'Import current events';

  const connectorGroups = [
    { name: 'AWS security telemetry', detail: 'CloudTrail, GuardDuty, and Security Hub normalization', sources: ['aws.cloudtrail', 'aws.guardduty', 'aws.securityhub'], preferred: 'aws.cloudtrail' },
    { name: 'Google Cloud security telemetry', detail: 'Audit Logs and Security Command Center normalization', sources: ['gcp.audit', 'gcp.scc'], preferred: 'gcp.audit' },
    { name: 'Kubernetes audit telemetry', detail: 'Audit event normalization plus separate manifest posture review', sources: ['kubernetes.audit'], preferred: 'kubernetes.audit' },
  ];
  const connectors = el('enterprise-connector-list');
  if (connectors) connectors.innerHTML = connectorGroups.map(group => {
    const sourceState = enterpriseSourceGroupState(group.sources, sources, events);
    return `<div class="enterprise-connector-row">
      <div class="enterprise-connector-mark" aria-hidden="true">${escapeHtml(group.name.slice(0, 2).toUpperCase())}</div>
      <div><strong>${escapeHtml(group.name)}</strong><span>${escapeHtml(group.detail)}</span></div>
      <div class="enterprise-connector-state"><span class="enterprise-state tone-${escapeHtml(sourceState.tone)}">${escapeHtml(sourceState.label)}</span><small>${escapeHtml(sourceState.detail)}</small></div>
      <button class="secondary-btn" data-enterprise-import-source="${escapeHtml(group.preferred)}" type="button">Import</button>
    </div>`;
  }).concat(`<div class="enterprise-connector-row">
    <div class="enterprise-connector-mark" aria-hidden="true">AI</div>
    <div><strong>Agent, host, Edge, and CI telemetry</strong><span>OpenClaw, Hermes, host sensors, Edge, and pipeline sources</span></div>
    <div class="enterprise-connector-state"><span class="enterprise-state tone-neutral">Managed in System</span><small>Existing normalized telemetry routes remain separate from cloud connector cursors</small></div>
    <button class="secondary-btn" data-enterprise-open-system type="button">Open System</button>
  </div>`).join('');

  const nextActions = [];
  if (!configured) nextActions.push(['Restore helper connection', 'The Enterprise store cannot be reached.', 'system']);
  else if (!sources.length) nextActions.push(['Import an approved source', 'Establish the first read-only source cursor and normalized event.', 'source']);
  else if (!events.length) nextActions.push(['Add current telemetry', 'Configured sources have not produced recent evidence.', 'source']);
  if (!Number(counts.vulnerabilities || 0)) nextActions.push(['Prioritize one real exposure', 'Create an explainable severity and remediation SLA baseline.', 'vulnerability']);
  if (!Number(counts.controls || 0)) nextActions.push(['Create the first control', 'Assign ownership and implementation state to a compliance requirement.', 'govern']);
  if (!workflows.length) nextActions.push(['Start an assurance workflow', 'Create a questionnaire, threat model, or authorized penetration-test record.', 'govern']);
  const nextActionsEl = el('enterprise-next-actions');
  if (nextActionsEl) nextActionsEl.innerHTML = nextActions.slice(0, 4).map(([title, detail, target], index) => `<button class="enterprise-next-action" data-enterprise-target="${escapeHtml(target)}" type="button"><span>${index + 1}</span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span><b aria-hidden="true">-&gt;</b></button>`).join('') || '<div class="enterprise-empty"><strong>Baseline established</strong><span>No immediate setup gaps were found. Continue reviewing activity and current exposure.</span></div>';

  const eventFilter = el('enterprise-event-filter');
  if (eventFilter) eventFilter.value = state.enterprise.eventFilter;
  const filteredEvents = events.filter(item => state.enterprise.eventFilter === 'all' || String(item.source || '').startsWith(state.enterprise.eventFilter));
  const activityList = el('enterprise-activity-list');
  if (activityList) activityList.innerHTML = filteredEvents.length ? filteredEvents.slice(0, 12).map(item => `<article class="enterprise-activity-item">
    <span class="enterprise-activity-dot tone-${escapeHtml(enterpriseTone(item.severity))}" aria-hidden="true"></span>
    <div><strong>${escapeHtml(humanizeMachineText(item.event_type || 'Security event'))}</strong><span>${escapeHtml(item.source || 'unknown source')}</span></div>
    <time>${escapeHtml(fmtDate(item.received_at || item.observed_at))}</time>
  </article>`).join('') : '<div class="enterprise-empty"><strong>No matching activity</strong><span>Import an approved event or change the source filter.</span></div>';
  const activitySummary = el('enterprise-activity-summary');
  if (activitySummary) activitySummary.textContent = `${filteredEvents.length} of ${events.length} recent events shown`;

  const vulnerabilityList = el('enterprise-vulnerability-list');
  if (vulnerabilityList) vulnerabilityList.innerHTML = vulnerabilities.length ? vulnerabilities.slice(0, 8).map(item => `<article class="enterprise-record">
    <span class="enterprise-state tone-${escapeHtml(enterpriseTone(item.severity))}">${escapeHtml(humanizeSnake(item.severity || 'unknown'))}</span>
    <div><strong>${escapeHtml(item.advisory_id || item.vulnerability_id || 'Vulnerability')}</strong><span>${escapeHtml([item.package_name, item.package_version].filter(Boolean).join('@') || 'Product not recorded')}</span></div>
    <small>${escapeHtml(item.sla_due_at ? `SLA ${fmtDate(item.sla_due_at)}` : `Updated ${fmtDate(item.updated_at)}`)}</small>
  </article>`).join('') : '<div class="enterprise-empty"><strong>No prioritized vulnerabilities</strong><span>Use the form above to create the first explainable exposure record.</span></div>';

  const governanceSummary = el('enterprise-governance-summary');
  if (governanceSummary) governanceSummary.innerHTML = [
    enterpriseReadinessItem('Controls', String(Number(counts.controls || 0)), 'Owned compliance requirements', Number(counts.controls || 0) ? 'good' : 'neutral'),
    enterpriseReadinessItem('Evidence', String(Number(counts.evidence || 0)), 'Linked assurance records', Number(counts.evidence || 0) ? 'good' : 'neutral'),
    enterpriseReadinessItem('Questionnaires', String(Number(counts.questionnaires || 0)), 'Customer and internal reviews', Number(counts.questionnaires || 0) ? 'good' : 'neutral'),
    enterpriseReadinessItem('Threat models / pen tests', String(Number(counts.threat_models || 0) + Number(counts.pentests || 0)), 'Engineering assurance workflows', Number(counts.threat_models || 0) + Number(counts.pentests || 0) ? 'good' : 'neutral')
  ].join('');
  const controlList = el('enterprise-control-list');
  if (controlList) controlList.innerHTML = controls.length ? controls.slice(0, 10).map(item => `<article class="enterprise-record"><span class="enterprise-state tone-${escapeHtml(enterpriseTone(item.status))}">${escapeHtml(humanizeSnake(item.status || 'not started'))}</span><div><strong>${escapeHtml(item.control_id || 'Control')}</strong><span>${escapeHtml(item.title || humanizeSnake(item.framework || ''))}</span></div><small>${escapeHtml(item.owner || 'Unassigned')}</small></article>`).join('') : '<div class="enterprise-empty"><strong>No controls saved</strong><span>Create a control above to start an evidence-backed governance baseline.</span></div>';
  const workflowList = el('enterprise-workflow-list');
  if (workflowList) workflowList.innerHTML = workflows.length ? workflows.slice(0, 10).map(item => `<article class="enterprise-record"><span class="enterprise-state tone-neutral">${escapeHtml(humanizeSnake(item.kind || 'workflow'))}</span><div><strong>${escapeHtml(item.record_id || 'Workflow')}</strong><span>${escapeHtml(item.title || 'Untitled assurance workflow')}</span></div><small>${escapeHtml(item.owner || 'Unassigned')}</small></article>`).join('') : '<div class="enterprise-empty"><strong>No assurance workflows</strong><span>Create a questionnaire, threat model, or penetration-test record above.</span></div>';

  for (const outputId of ['enterprise-ingest-output', 'enterprise-vuln-output', 'enterprise-kubernetes-output', 'enterprise-dast-output', 'enterprise-control-output', 'enterprise-workflow-output']) {
    const target = el(outputId);
    if (target) target.innerHTML = enterpriseResultMarkup(state.enterprise.outputs[outputId]);
  }
  const workflowKind = el('enterprise-workflow-kind')?.value || 'questionnaire';
  document.querySelectorAll('[data-enterprise-workflow-field]').forEach(field => { field.hidden = field.dataset.enterpriseWorkflowField !== workflowKind; });
  renderArtifactFleet();
}

async function runEnterpriseAction(action, payload, button, outputId) {
  if (!state.intelligence.adminToken) {
    showToast('Add the Automation action token in Administration before running protected Enterprise actions.', 'error');
    setPage('automation');
    return null;
  }
  sessionStorage.setItem('secopsai_intelligence_admin_token', state.intelligence.adminToken);
  setButtonBusy(button, true, 'Working...');
  try {
    const response = await dashboardApiFetch('/api/secopsai/enterprise-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SecOpsAI-Intelligence-Token': state.intelligence.adminToken },
      body: JSON.stringify({ action, ...payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || `Enterprise ${action} HTTP ${response.status}`);
    setEnterpriseOutput(outputId, enterpriseActionOutput(action, result));
    showToast(`Enterprise action completed: ${humanizeSnake(action)}`, 'success');
    await loadEnterpriseStatus();
    return result;
  } catch (error) {
    const message = error?.message || String(error);
    setEnterpriseOutput(outputId, { tone: 'danger', title: 'Action could not be completed', summary: message, details: ['Review the inputs and helper status, then retry.'] });
    showToast(message, 'error');
    return null;
  } finally {
    setButtonBusy(button, false);
  }
}

function openEnterpriseImport(source = '') {
  state.enterprise.activeTab = 'monitor';
  renderEnterprise();
  const drawer = el('enterprise-source-intake');
  if (drawer) drawer.open = true;
  if (source && el('enterprise-ingest-source')) el('enterprise-ingest-source').value = source;
  drawer?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function selectEnterpriseTab(tab) {
  if (!['monitor', 'assess', 'govern'].includes(tab)) return;
  state.enterprise.activeTab = tab;
  renderEnterprise();
}

function selectEnterpriseAssessment(assessment) {
  if (!['vulnerability', 'kubernetes', 'dast', 'artifact'].includes(assessment)) return;
  state.enterprise.activeTab = 'assess';
  state.enterprise.activeAssessment = assessment;
  renderEnterprise();
}

function enterpriseWorkflowRecord() {
  const kind = el('enterprise-workflow-kind')?.value || 'questionnaire';
  const recordId = el('enterprise-workflow-id')?.value?.trim() || '';
  const common = {
    title: el('enterprise-workflow-title')?.value?.trim() || '',
    owner: el('enterprise-workflow-owner')?.value?.trim() || '',
  };
  if (kind === 'questionnaire') {
    return {
      kind,
      record: {
        ...common,
        questionnaire_id: recordId,
        customer: el('enterprise-workflow-customer')?.value?.trim() || '',
        questions: [{
          question_id: `${recordId || 'questionnaire'}-Q1`,
          question: el('enterprise-workflow-question')?.value?.trim() || '',
          answer: el('enterprise-workflow-answer')?.value?.trim() || '',
          status: 'draft',
        }]
      }
    };
  }
  if (kind === 'threat-model') {
    return {
      kind,
      record: {
        ...common,
        threat_model_id: recordId,
        assets: [el('enterprise-workflow-asset')?.value?.trim() || ''].filter(Boolean).map(name => ({ name })),
        threats: [el('enterprise-workflow-threat')?.value?.trim() || ''].filter(Boolean).map(name => ({ name })),
        mitigations: [el('enterprise-workflow-mitigation')?.value?.trim() || ''].filter(Boolean).map(description => ({ description })),
      }
    };
  }
  return {
    kind,
    record: {
      ...common,
      engagement_id: recordId,
      scope: [el('enterprise-workflow-scope')?.value?.trim() || ''].filter(Boolean),
      authorized_by: el('enterprise-workflow-authorization')?.value?.trim() || '',
    }
  };
}

async function loadArtifactFleetStatus({ render = true } = {}) {
  state.artifactFleet.loading = true;
  if (render) renderArtifactFleet();
  try {
    const response = await dashboardApiFetch('/api/secopsai/artifact-fleet-status');
    const payload = await response.json().catch(() => ({}));
    state.artifactFleet.data = payload;
    state.artifactFleet.error = response.ok ? null : (payload.error || `Artifact Fleet HTTP ${response.status}`);
  } catch (error) {
    state.artifactFleet.error = error?.message || String(error);
    state.artifactFleet.data = { ok: false, error: state.artifactFleet.error };
  } finally {
    state.artifactFleet.loading = false;
    if (render) renderArtifactFleet();
  }
  return state.artifactFleet.data;
}

function renderArtifactFleet() {
  const data = state.artifactFleet.data || {};
  const result = data.result || {};
  const artifacts = result.artifacts || {};
  const queue = result.queue || {};
  const triage = result.triage || {};
  const awaitingCollection = Number(queue.scan_awaiting_collection || 0);
  const summary = el('artifact-fleet-summary');
  if (summary) summary.innerHTML = [
    ['Artifacts indexed', String(Object.values(artifacts).reduce((sum, value) => sum + Number(value || 0), 0)), 'Metadata stage', 'neutral'],
    ['Scan ready', String(queue.scan_pending || 0), `${awaitingCollection} metadata record${awaitingCollection === 1 ? '' : 's'} awaiting approved collection`, Number(queue.scan_pending || 0) ? 'warning' : 'neutral'],
    ['Model triage', String(triage.awaiting_model || 0), 'Minimized context only', Number(triage.awaiting_model || 0) ? 'warning' : 'neutral'],
    ['Analyst review', String(triage.analyst_review || 0), 'Suspicious or inconclusive', Number(triage.analyst_review || 0) ? 'danger' : 'neutral']
  ].map(([label, value, scope, tone]) => enterpriseReadinessItem(label, value, scope, tone)).join('');
  const queueEl = el('artifact-fleet-queue');
  if (queueEl) {
    const analystRows = Array.isArray(result.analyst_queue) ? result.analyst_queue : [];
    const analystText = analystRows.length ? ` · analyst queue: ${analystRows.slice(0, 5).map(item => item.artifact_id || 'artifact').join(', ')}` : '';
    queueEl.textContent = state.artifactFleet.error
      ? `Artifact Fleet unavailable: ${state.artifactFleet.error}. Use local helper mode for fixture scans and queue inspection.`
      : `Queue: ${Object.entries(queue).map(([key, value]) => `${humanizeMachineText(key)} ${value}`).join(' · ') || 'empty'}${result.dead_letters ? ` · dead letters ${result.dead_letters}` : ''}${analystText}`;
  }
  const healthEl = el('artifact-fleet-health');
  if (healthEl) {
    const sources = Array.isArray(result.sources) ? result.sources : [];
    const configured = sources.filter(item => item?.status === 'healthy').length;
    const rules = result.rules || {};
    const metricRows = Array.isArray(result.metrics) ? result.metrics.slice(0, 4) : [];
    healthEl.textContent = state.artifactFleet.error
      ? ''
      : `Sources: ${configured}/${sources.length || 0} configured · rules: ${rules.status === 'valid' ? 'valid' : 'check required'}${metricRows.length ? ` · metrics: ${metricRows.map(item => `${humanizeMachineText(item.metric || item.stage || 'metric')} ${item.value}`).join(', ')}` : ''}`;
  }
  const output = el('artifact-fleet-output');
  if (output) {
    output.textContent = state.artifactFleet.output || '';
    output.hidden = !state.artifactFleet.output;
  }
  const safetyNote = el('artifact-fleet-safety-note');
  if (safetyNote) {
    safetyNote.textContent = state.artifactFleet.error
      ? `Artifact Fleet is unavailable here: ${state.artifactFleet.error}. Start the local helper for allowlisted actions; hosted mode does not run local artifact commands.`
      : 'Buttons use the Automation action token and an allowlisted local helper command. They never install, execute, or activate an artifact. Exact single-artifact scans still require the reviewed CLI path.';
  }
  const researchOutput = el('source-research-output');
  if (researchOutput) {
    researchOutput.textContent = state.artifactFleet.researchOutput || '';
    researchOutput.hidden = !state.artifactFleet.researchOutput;
  }
  const researchResult = state.artifactFleet.researchResult?.result || state.artifactFleet.researchResult || {};
  const researchCaseId = String(researchResult.case_id || researchResult.research?.case_id || '').trim();
  const researchArtifactId = String(researchResult.artifact?.artifact_id || researchResult.scan?.artifact_id || '').trim();
  const completedActions = new Set(state.artifactFleet.researchCompletedActions || []);
  const exactComparisonRequested = Boolean(
    el('source-research-compare-subject')?.value?.trim()
    || researchResult.comparison_package
    || researchResult.comparison
  );
  const readiness = [
    ['Source metadata collected', Boolean(researchResult.metadata || researchResult.package || completedActions.has('metadata'))],
    ['Artifact identity recorded', Boolean(researchResult.artifact?.sha256)],
    ['Static and YARA evidence recorded', Boolean(researchResult.scan?.artifact_id)],
    ['Verified comparison recorded', exactComparisonRequested ? Boolean(researchResult.comparison) : false],
    ['Research Case created', Boolean(researchCaseId)],
    ['Evidence matrix built', Boolean(researchResult.evidence_matrix || completedActions.has('matrix'))],
    ['Selected-model triage queued', Boolean(researchResult.model_job || completedActions.has('queue'))],
    ['Review-only draft created', completedActions.has('draft')],
  ];
  const readyCount = readiness.filter(([, ready]) => ready).length;
  const readinessEl = el('source-research-readiness');
  if (readinessEl) readinessEl.innerHTML = readiness.map(([label, ready]) => `<div class="research-evidence-row ${ready ? 'complete' : ''}"><span aria-hidden="true">${ready ? '✓' : '○'}</span><strong>${escapeHtml(label)}</strong></div>`).join('');
  const readinessScore = el('source-research-readiness-score');
  if (readinessScore) readinessScore.textContent = `${readyCount}/8`;
  const readinessMessage = el('source-research-readiness-message');
  if (readinessMessage) readinessMessage.textContent = readyCount === 8
    ? 'The review-only draft exists. An analyst must still verify claims and approve publication.'
    : researchCaseId
      ? `${8 - readyCount} evidence step${8 - readyCount === 1 ? '' : 's'} remain. Draft creation does not publish or deploy.`
      : 'Run source-first research to create evidence. A malware claim is never inferred from a package name alone.';
  const stages = el('research-production-stages');
  if (stages) {
    const stageReady = [readyCount >= 1, readyCount >= 3, readyCount >= 7, false, readyCount >= 8];
    stages.querySelectorAll('.research-stage').forEach((stage, index) => {
      stage.classList.toggle('complete', Boolean(stageReady[index]));
      stage.classList.toggle('active', index === stageReady.findIndex(value => !value));
    });
  }
  for (const [id, enabled] of [
    ['source-research-matrix-btn', Boolean(researchCaseId)],
    ['source-research-draft-btn', Boolean(researchCaseId && (researchResult.evidence_matrix || completedActions.has('matrix')))],
    ['source-research-open-case-btn', Boolean(researchCaseId)],
    ['source-research-queue-btn', Boolean(researchArtifactId)],
  ]) {
    const button = el(id);
    if (button) button.disabled = !enabled;
  }
}

async function runArtifactFleetAction(action, payload = {}, button = null) {
  const tokenInput = el('intelligence-admin-token');
  state.intelligence.adminToken = tokenInput?.value?.trim() || state.intelligence.adminToken;
  if (!state.intelligence.adminToken) {
    showToast('Add the Automation action token in Administration before running Artifact Fleet actions.', 'error');
    setPage('automation');
    return null;
  }
  sessionStorage.setItem('secopsai_intelligence_admin_token', state.intelligence.adminToken);
  setButtonBusy(button, true, 'Working…');
  try {
    const body = { action, ...payload };
    if (action === 'triage' && !body.model && state.intelligence.selectedModel) body.model = state.intelligence.selectedModel;
    const response = await dashboardApiFetch('/api/secopsai/artifact-fleet', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SecOpsAI-Intelligence-Token': state.intelligence.adminToken
      },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || `Artifact Fleet ${action} HTTP ${response.status}`);
    state.artifactFleet.output = JSON.stringify(result.result || result, null, 2);
    showToast(`Artifact Fleet action completed: ${humanizeSnake(action)}`, 'success');
    await loadArtifactFleetStatus();
    return result;
  } catch (error) {
    state.artifactFleet.error = error?.message || String(error);
    state.artifactFleet.output = JSON.stringify({ ok: false, action, error: state.artifactFleet.error }, null, 2);
    renderArtifactFleet();
    showToast(state.artifactFleet.error, 'error');
    return null;
  } finally {
    setButtonBusy(button, false);
  }
}

function sourceResearchPayload(action) {
  return {
    action,
    research_type: el('source-research-type')?.value || 'package_artifact',
    ecosystem: el('source-research-ecosystem')?.value || 'npm',
    package: el('source-research-subject')?.value?.trim() || '',
    version: el('source-research-version')?.value?.trim() || '',
    compare_package: el('source-research-compare-subject')?.value?.trim() || '',
    compare_version: el('source-research-compare-version')?.value?.trim() || '',
    source_reference: el('source-research-source')?.value?.trim() || '',
    source_repository: el('source-research-repository')?.value?.trim() || '',
    persist_findings: Boolean(el('source-research-persist')?.checked),
    create_case: el('source-research-create-case')?.checked !== false,
    model: state.intelligence.selectedModel || ''
  };
}

function updateSourceResearchForm() {
  const ecosystem = el('source-research-ecosystem')?.value || '';
  const subjectLabel = el('source-research-subject-label');
  const subject = el('source-research-subject');
  const compareLabel = el('source-research-compare-label');
  if (ecosystem === 'crates') {
    if (subjectLabel) subjectLabel.textContent = 'Crate package';
    if (subject) subject.placeholder = 'proc-macro1';
    if (compareLabel) compareLabel.textContent = 'Comparison crate (optional)';
  } else if (ecosystem === 'github') {
    if (subjectLabel) subjectLabel.textContent = 'Repository';
    if (subject) subject.placeholder = 'owner/repository';
    if (compareLabel) compareLabel.textContent = 'Comparison repository (optional)';
  } else if (ecosystem === 'open-vsx' || ecosystem === 'chrome-web-store') {
    if (subjectLabel) subjectLabel.textContent = 'Extension ID';
    if (subject) subject.placeholder = 'publisher.extension';
    if (compareLabel) compareLabel.textContent = 'Known-good extension (optional)';
  } else {
    if (subjectLabel) subjectLabel.textContent = 'Package or artifact';
    if (subject) subject.placeholder = ecosystem === 'packagist' ? 'vendor/package' : '@scope/package or package';
    if (compareLabel) compareLabel.textContent = 'Comparison subject (optional)';
  }
}

async function runSourceFirstResearchAction(action, button = null) {
  const tokenInput = el('intelligence-admin-token');
  state.intelligence.adminToken = tokenInput?.value?.trim() || state.intelligence.adminToken;
  if (!state.intelligence.adminToken) {
    showToast('Add the Automation action token in Administration before running source-first research.', 'error');
    setPage('automation');
    return null;
  }
  const payload = sourceResearchPayload(action);
  if (!payload.package) {
    showToast('Enter a package, extension, repository, or artifact identifier first.', 'error');
    return null;
  }
  sessionStorage.setItem('secopsai_intelligence_admin_token', state.intelligence.adminToken);
  setButtonBusy(button, true, 'Working…');
  try {
    const response = await dashboardApiFetch('/api/secopsai/source-first-research', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SecOpsAI-Intelligence-Token': state.intelligence.adminToken
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || `Source-first research HTTP ${response.status}`);
    state.artifactFleet.researchError = null;
    state.artifactFleet.researchOutput = JSON.stringify(result.result || result, null, 2);
    state.artifactFleet.researchResult = result;
    state.artifactFleet.researchCompletedActions = [...new Set([
      ...state.artifactFleet.researchCompletedActions,
      action === 'preview' ? 'metadata' : 'intake'
    ])];
    const cliArg = value => `'${String(value).replaceAll("'", "'\\''")}'`;
    state.artifactFleet.researchCommand = [
      'secopsai research investigate',
      `--ecosystem ${cliArg(payload.ecosystem)}`,
      `--research-type ${cliArg(payload.research_type)}`,
      `--package ${cliArg(payload.package)}`,
      `--version ${cliArg(payload.version)}`,
      payload.compare_package ? `--comparison-package ${cliArg(payload.compare_package)}` : '',
      payload.compare_version ? `--comparison-version ${cliArg(payload.compare_version)}` : '',
      payload.source_reference ? `--source-reference ${cliArg(payload.source_reference)}` : '',
      payload.source_repository ? `--source-repository ${cliArg(payload.source_repository)}` : '',
      payload.persist_findings ? '--persist-findings' : '',
      '--json',
    ].filter(Boolean).join(' ');
    showToast(`Source-first research completed: ${humanizeSnake(action)}`, 'success');
    await loadArtifactFleetStatus();
    return result;
  } catch (error) {
    state.artifactFleet.researchError = error?.message || String(error);
    state.artifactFleet.researchOutput = JSON.stringify({ ok: false, action, error: state.artifactFleet.researchError }, null, 2);
    renderArtifactFleet();
    showToast(state.artifactFleet.researchError, 'error');
    return null;
  } finally {
    setButtonBusy(button, false);
  }
}

async function runSourceResearchFollowup(action, button = null) {
  const result = state.artifactFleet.researchResult?.result || state.artifactFleet.researchResult || {};
  const caseId = String(result.case_id || '').trim();
  const artifactId = String(result.artifact?.artifact_id || result.scan?.artifact_id || '').trim();
  if (action === 'open-case') {
    if (!caseId) return null;
    return openResearchCase(caseId);
  }
  if (action === 'copy-cli') {
    if (state.artifactFleet.researchCommand) await copyTextWithStatus(state.artifactFleet.researchCommand, 'Source-first research CLI copied');
    return state.artifactFleet.researchCommand;
  }
  if (!caseId && action !== 'queue') {
    showToast('Run source-first research first so a Research Case is available.', 'error');
    return null;
  }
  if (action === 'queue' && !artifactId) {
    showToast('Run source-first research first so an artifact is available.', 'error');
    return null;
  }
  const tokenInput = el('intelligence-admin-token');
  state.intelligence.adminToken = tokenInput?.value?.trim() || state.intelligence.adminToken;
  if (!state.intelligence.adminToken) {
    showToast('Add the Automation action token in Administration before running this follow-up.', 'error');
    setPage('automation');
    return null;
  }
  setButtonBusy(button, true, 'Working…');
  try {
    const response = await dashboardApiFetch('/api/secopsai/source-first-research', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-SecOpsAI-Intelligence-Token': state.intelligence.adminToken},
      body: JSON.stringify({action, case_id: caseId, artifact_id: artifactId, model: state.intelligence.selectedModel || ''})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Source-first research follow-up HTTP ${response.status}`);
    state.artifactFleet.researchOutput = JSON.stringify(payload.result || payload, null, 2);
    state.artifactFleet.researchCompletedActions = [...new Set([...state.artifactFleet.researchCompletedActions, action])];
    state.artifactFleet.researchFollowupResults[action] = payload.result || payload;
    showToast(`Source-first research follow-up completed: ${humanizeSnake(action)}`, 'success');
    await loadArtifactFleetStatus();
    return payload;
  } catch (error) {
    showToast(error?.message || String(error), 'error');
    return null;
  } finally {
    setButtonBusy(button, false);
  }
}

async function loadLocalTriageState() {
  try {
    const res = await dashboardApiFetch('/api/secopsai/triage-state');
    if (!res.ok) throw new Error(`Local triage HTTP ${res.status}`);
    state.localTriage = await res.json();
    applyNativeFindingStatuses(state.localTriage);
    await refreshSelectedSessionDetail();
  } catch (error) {
    console.warn('local triage load failed', error);
    state.localTriage = { ok: false, error: error?.message || String(error) };
    state.selectedSessionDetail = null;
  }
}

function applyNativeStreamPayload(payload) {
  if (!payload || payload.ok === false || !payload.sessions) return;
  state.localTriage = payload;
  applyNativeFindingStatuses(payload);
  state.nativeStreamLastEventAt = new Date().toISOString();
  const selectedId = String(state.selectedSessionId || '').trim();
  if (selectedId) {
    const recent = recentLocalSessions();
    const compact = recent.find(item => String(item?.session_id || '') === selectedId);
    if (compact && state.selectedSessionDetail) {
      state.selectedSessionDetail = { ...state.selectedSessionDetail, ...compact };
    }
  }
  renderMissionControl();
  renderFindings();
  renderIntegrations();
  renderTriageOps();
}

function startNativeEventStream() {
  if (!window.EventSource) return;
  if (state.nativeEventSource) {
    state.nativeEventSource.close();
    state.nativeEventSource = null;
  }
  try {
    const source = new EventSource('/api/secopsai/events?interval=5');
    state.nativeEventSource = source;
    state.nativeStreamStatus = 'connecting';
    source.addEventListener('open', () => {
      state.nativeStreamStatus = 'connected';
      renderIntegrations();
    });
    source.addEventListener('triage-state', event => {
      state.nativeStreamStatus = 'connected';
      try {
        applyNativeStreamPayload(JSON.parse(event.data || '{}'));
      } catch (error) {
        console.warn('native stream parse failed', error);
      }
    });
    source.addEventListener('heartbeat', () => {
      state.nativeStreamStatus = 'connected';
      state.nativeStreamLastEventAt = new Date().toISOString();
      renderIntegrations();
    });
    source.addEventListener('error', () => {
      state.nativeStreamStatus = 'reconnecting';
      renderIntegrations();
    });
  } catch (error) {
    console.warn('native event stream failed to start', error);
    state.nativeStreamStatus = 'unavailable';
  }
}

async function createDashboardEvent(event_type, title, body, severity = 'info', related = {}) {
  const payload = { event_type, title, body, severity, ...related };
  const { data, error } = await supabaseClient.from('dashboard_events').insert(payload).select().single();
  if (error) {
    console.error('dashboard_events insert failed', error);
    return null;
  }
  return data;
}

async function createOrchestratorRun({ taskSummary, taskDetail = null, status = 'completed', outputSummary = null, relatedWorkItemId = null, outputPath = null, sourceChannelName = null }) {
  const now = new Date().toISOString();
  const route = sourceChannelName ? state.channelRoutes.find(r => r.channel_name === sourceChannelName) : null;
  const payload = {
    role_label: 'exec/agents-orchestrator',
    runtime: 'dashboard-auto',
    model_used: 'dashboard-queue',
    task_summary: taskSummary,
    task_detail: taskDetail,
    status,
    source_surface: 'dashboard',
    source_channel_id: route?.channel_id || null,
    initiated_by: 'Techris',
    output_path: outputPath,
    output_summary: outputSummary,
    started_at: now,
    completed_at: ['completed', 'failed', 'cancelled'].includes(status) ? now : null
  };
  const { data, error } = await supabaseClient.from('agent_runs').insert(payload).select().single();
  if (error) {
    console.error('agent_runs insert failed', error);
    return null;
  }
  if (relatedWorkItemId) {
    await supabaseClient.from('work_items').update({ linked_run_id: data.id }).eq('id', relatedWorkItemId);
  }
  return data;
}

async function announceTaskChange(kind, item, details, severity = 'info') {
  const event = await createDashboardEvent(kind, details.title, details.body, severity, { related_work_item_id: item?.id || null });
  const run = await createOrchestratorRun({
    taskSummary: details.runSummary,
    taskDetail: details.runDetail,
    outputSummary: details.outputSummary,
    relatedWorkItemId: item?.id || null
  });
  return { event, run };
}

async function saveTask(options = {}) {
  const sourceFinding = taskModalState.sourceFinding;
  const saveBtn = el('task-save-btn');
  const saveRunBtn = el('task-save-run-btn');
  if (saveBtn) saveBtn.disabled = true;
  if (saveRunBtn) saveRunBtn.disabled = true;
  const payload = {
    title: el('task-title').value.trim(),
    domain: el('task-domain').value,
    priority: el('task-priority').value,
    status: options.runAfterSave ? 'planned' : el('task-status').value,
    owner_role: el('task-owner-role').value.trim() || null,
    reviewer_role: el('task-reviewer-role').value.trim() || null,
    due_date: el('task-due-date').value || null,
    created_by: el('task-created-by').value.trim() || null,
    external_facing: el('task-external-facing').checked,
    requires_security_review: el('task-security-review').checked,
    description: el('task-description').value.trim() || null,
    updated_at: new Date().toISOString()
  };
  if (!payload.title) {
    if (saveBtn) saveBtn.disabled = false;
    if (saveRunBtn) saveRunBtn.disabled = false;
    notifyError('Task title is required.');
    return;
  }

  try {
    let item = null;
    if (taskModalState.editingId) {
      const { data, error } = await supabaseClient.from('work_items').update(payload).eq('id', taskModalState.editingId).select().single();
      if (error) {
        notifyError(`Failed to update task: ${error.message}`);
        return;
      }
      item = data;
      upsertWorkItemInState(item);
      closeTaskModal();
      refreshTaskViewsOnly();
      setStatus(`<span class="dot"></span> Task saved: ${escapeHtml(payload.title)}`);
      Promise.resolve().then(() => announceTaskChange('task_updated', item, {
        title: `Task updated: ${payload.title}`,
        body: `Status: ${payload.status} • Priority: ${payload.priority}`,
        runSummary: `Updated work item: ${payload.title}`,
        runDetail: payload.description || 'Task updated from dashboard modal.',
        outputSummary: `Status set to ${payload.status}`,
        kanbanTitle: `Kanban update: ${payload.title}`,
        kanbanBody: `${payload.status} • ${payload.priority}`
      }, 'info')).then(backgroundRefreshOpsData).catch(e => console.warn('task_updated side effects failed', e));
    } else {
      const { data, error } = await supabaseClient.from('work_items').insert(payload).select().single();
      if (error) {
        notifyError(`Failed to create task: ${error.message}`);
        return;
      }
      item = data;
      upsertWorkItemInState(item);
      closeTaskModal();
      refreshTaskViewsOnly();
      setStatus(`<span class="dot"></span> Task created: ${escapeHtml(payload.title)}`);
      if (options.runAfterSave) {
        await queueTaskExecutionDirect(item);
      }
      Promise.resolve().then(async () => {
        const linked = await bestEffortLinkFindingToTask(sourceFinding, item);
        await announceTaskChange('task_created', item, {
          title: `Task created: ${payload.title}`,
          body: `Domain: ${payload.domain} • Priority: ${payload.priority}${sourceFinding ? ` • From finding: ${findingTitle(sourceFinding)}` : ''}`,
          runSummary: `Created work item: ${payload.title}`,
          runDetail: payload.description || 'Task created from dashboard modal.',
          outputSummary: `Initial status ${payload.status}${linked ? ' • finding linked' : ''}`,
          kanbanTitle: `Kanban new item: ${payload.title}`,
          kanbanBody: `${payload.domain} • ${payload.status}`
        }, 'success');
      }).then(backgroundRefreshOpsData).catch(e => console.warn('task_created side effects failed', e));
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    if (saveRunBtn) saveRunBtn.disabled = false;
  }
}

async function deleteTask() {
  console.debug('deleteTask invoked', { editingId: taskModalState.editingId });
  const item = currentTaskModalItem();
  const taskId = taskModalState.editingId || item?.id || null;
  if (!taskId) {
    notifyError('No task is selected for deletion. Close and reopen the task, then try again.');
    return;
  }
  if (!(await requestConfirmation(`Delete this task${item?.title ? `: ${item.title}` : ''}?`, {
    title: 'Delete work item',
    context: 'This removes the work item from the active queue and records the deletion event.',
    confirmLabel: 'Delete task',
    danger: true
  }))) return;
  const { error } = await supabaseClient.from('work_items').delete().eq('id', taskId);
  if (error) {
    notifyError(`Failed to delete task: ${error.message}`);
    return;
  }
  removeWorkItemFromState(taskId);
  taskModalState.editingId = null;
  taskModalState.sourceFinding = null;
  closeTaskModal();
  refreshTaskViewsOnly();
  setStatus(`<span class="dot"></span> Task deleted: ${escapeHtml(item?.title || 'Untitled task')}`);
  Promise.resolve().then(() => announceTaskChange('task_deleted', item, {
    title: `Task deleted: ${item?.title || 'Untitled task'}`,
    body: 'Task removed from dashboard kanban.',
    runSummary: `Deleted work item: ${item?.title || 'Untitled task'}`,
    runDetail: item?.description || 'Task deleted from dashboard modal.',
    outputSummary: 'Task removed from work_items.',
    kanbanTitle: `Kanban deleted: ${item?.title || 'Untitled task'}`,
    kanbanBody: 'Removed from board.'
  }, 'warning')).then(backgroundRefreshOpsData).catch(e => console.warn('task_deleted side effects failed', e));
}

async function moveTaskToStatus(taskId, nextStatus) {
  const item = state.workItems.find(w => w.id === taskId);
  if (!item || item.status === nextStatus) return;
  const { data, error } = await supabaseClient.from('work_items').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', taskId).select().single();
  if (error) {
    notifyError(`Failed to move task: ${error.message}`);
    return;
  }
  upsertWorkItemInState(data);
  refreshTaskViewsOnly();
  Promise.resolve().then(() => announceTaskChange('task_moved', data, {
    title: `Task moved: ${item.title}`,
    body: `${item.status} → ${nextStatus}`,
    runSummary: `Moved work item: ${item.title}`,
    runDetail: `Status changed from ${item.status} to ${nextStatus} via dashboard drag-and-drop.`,
    outputSummary: `${item.status} → ${nextStatus}`,
    kanbanTitle: `Kanban moved: ${item.title}`,
    kanbanBody: `${statusLabel(item.status)} → ${statusLabel(nextStatus)}`
  }, 'info')).then(backgroundRefreshOpsData).catch(e => console.warn('task_moved side effects failed', e));
}


async function backgroundRefreshLiveExecutionState() {
  try {
    const [runs, runRequests] = await Promise.all([
      loadTable('agent_runs', { orderBy: { column: 'created_at', ascending: false }, limit: 200 }),
      optionalLoadTable('run_requests', { orderBy: { column: 'created_at', ascending: false }, limit: 100 })
    ]);
    state.runs = runs;
    state.runRequests = runRequests;
    await loadLocalTriageState();
    await hydrateRunRequestOutputEvidence();
    await synchronizeSuccessfulTaskTransitions();
    renderTasks();
    renderMissionControl();
    renderFindings();
    renderIntegrations();
  } catch (e) {
    console.warn('background live execution refresh failed', e);
  }
}

async function refreshOperationalWorkspace() {
  const [runs, workItems, events, runRequests, findings] = await Promise.all([
    loadTable('agent_runs', { orderBy: { column: 'created_at', ascending: false }, limit: 200 }),
    loadTable('work_items', { orderBy: { column: 'updated_at', ascending: false }, limit: 200 }),
    loadTable('dashboard_events', { orderBy: { column: 'created_at', ascending: false }, limit: 100 }),
    optionalLoadTable('run_requests', { orderBy: { column: 'created_at', ascending: false }, limit: 100 }),
    optionalLoadTable('findings', { orderBy: { column: 'created_at', ascending: false }, limit: 100 })
  ]);
  state.runs = runs;
  state.workItems = workItems;
  state.events = events;
  state.runRequests = runRequests;
  state.findings = sortLatestFirst(findings, FINDING_LATEST_FIELDS);
  await Promise.all([loadIntegrationStatus(), loadLocalTriageState()]);
  await hydrateRunRequestOutputEvidence();
  await synchronizeSuccessfulTaskTransitions();
  renderTasks();
  renderMissionControl();
  renderFindings();
  renderIntegrations();
  return true;
}

async function refreshActiveSurface({ force = false } = {}) {
  const now = Date.now();
  if (state.surfaceRefreshInFlight || document.hidden) return false;
  if (!force && now - state.lastSurfaceRefreshAt < 4000) return false;
  state.surfaceRefreshInFlight = true;
  try {
    const page = currentPageFromLocation();
    if (page === 'mission-control') {
      await Promise.all([refreshOperationalWorkspace(), loadIntelligence({ render: false })]);
      renderMissionControl();
    } else if (page === 'findings') {
      await refreshOperationalWorkspace();
    } else if (page === 'tasks') {
      await Promise.all([refreshOperationalWorkspace(), loadSpecialists({ render: false })]);
      renderSpecialistOverview();
    } else if (page === 'edge') {
      await loadEdgeWorkspace({ render: false });
      renderEdgeWorkspace();
    } else if (page === 'integrations') {
      await Promise.all([loadIntegrationStatus(), loadLocalTriageState()]);
      renderIntegrations();
    } else if (page === 'automation') {
      await Promise.all([loadIntegrationStatus(), loadIntelligence({ render: false })]);
      renderAutomation();
    } else if (page === 'enterprise') {
      await Promise.all([loadEnterpriseStatus({ render: false }), loadArtifactFleetStatus({ render: false })]);
      renderEnterprise();
    } else if (page === 'triage-ops') {
      await loadTriageOpsAlerts({ render: false });
      renderTriageOps();
    } else if (page === 'research-cases') {
      const pipeline = (state.researchCases.selected?.pipelines || [])[0];
      const pipelinePollActive = pipeline && ['running', 'awaiting_ai'].includes(pipeline.status);
      if (!pipelinePollActive && (force || now - state.lastResearchSurfaceRefreshAt >= 30000)) {
        await loadResearchCases({ render: false, preserveSelection: true });
        state.lastResearchSurfaceRefreshAt = Date.now();
      }
      renderResearchCases();
    } else if (page === 'coverage') {
      await loadCoverage({ render: false });
      renderCoverage();
    } else if (page === 'blog-ops') {
      await loadBlogOpsStatus({ render: false });
      renderBlogOps();
    }
    state.lastSurfaceRefreshAt = Date.now();
    return true;
  } catch (error) {
    console.warn('active surface refresh failed', error);
    return false;
  } finally {
    state.surfaceRefreshInFlight = false;
  }
}

function startLiveExecutionRefreshLoop() {
  if (state.liveRefreshTimer) clearInterval(state.liveRefreshTimer);
  state.liveRefreshTimer = setInterval(() => {
    backgroundRefreshLiveExecutionState();
  }, 5000);
  if (state.surfaceRefreshTimer) clearInterval(state.surfaceRefreshTimer);
  state.surfaceRefreshTimer = setInterval(() => {
    refreshActiveSurface();
  }, 5000);
}

async function boot() {
  const errors = [];
  const requiredLoads = [
    ['channelRoutes', 'channel_routes', { orderBy: { column: 'channel_name', ascending: true } }],
    ['runs', 'agent_runs', { orderBy: { column: 'created_at', ascending: false }, limit: 200 }],
    ['workItems', 'work_items', { orderBy: { column: 'updated_at', ascending: false }, limit: 200 }],
    ['events', 'dashboard_events', { orderBy: { column: 'created_at', ascending: false }, limit: 100 }]
  ];

  for (const [stateKey, table, options] of requiredLoads) {
    try {
      state[stateKey] = await loadTable(table, options);
    } catch (err) {
      console.error(`failed loading ${table}`, err);
      state[stateKey] = [];
      errors.push(`${table}: ${err.message || String(err)}`);
    }
  }

  state.runRequests = await optionalLoadTable('run_requests', { orderBy: { column: 'created_at', ascending: false }, limit: 100 });
  state.findings = sortLatestFirst(await optionalLoadTable('findings', { orderBy: { column: 'created_at', ascending: false }, limit: 100 }), FINDING_LATEST_FIELDS);

  try {
    await hydrateRunRequestOutputEvidence();
  } catch (err) {
    console.warn('hydrateRunRequestOutputEvidence failed', err);
    errors.push(`run output evidence: ${err.message || String(err)}`);
  }

  try {
    await synchronizeSuccessfulTaskTransitions();
  } catch (err) {
    console.warn('synchronizeSuccessfulTaskTransitions failed during boot', err);
    errors.push(`task sync: ${err.message || String(err)}`);
  }

  try {
    await loadIntegrationStatus();
  } catch (err) {
    console.warn('loadIntegrationStatus failed during boot', err);
    errors.push(`integration status: ${err.message || String(err)}`);
  }

  try {
    await loadSpecialists({ render: false });
  } catch (err) {
    console.warn('loadSpecialists failed during boot', err);
    errors.push(`specialist orchestrator: ${err.message || String(err)}`);
  }

  try {
    await loadEnterpriseStatus({ render: false });
  } catch (err) {
    console.warn('loadEnterpriseStatus failed during boot', err);
  }
  try {
    await loadArtifactFleetStatus({ render: false });
  } catch (err) {
    console.warn('loadArtifactFleetStatus failed during boot', err);
  }

  try {
    await loadLocalTriageState();
  } catch (err) {
    console.warn('loadLocalTriageState failed during boot', err);
    errors.push(`local triage: ${err.message || String(err)}`);
  }

  try {
    await loadEdgeWorkspace({ render: false });
  } catch (err) {
    console.warn('loadEdgeWorkspace failed during boot', err);
    errors.push(`Edge workspace: ${err.message || String(err)}`);
  }

  try {
    await loadBlogOpsStatus({ render: false });
  } catch (err) {
    console.warn('loadBlogOpsStatus failed during boot', err);
  }

  try {
    await loadTriageOpsAlerts({ render: false });
  } catch (err) {
    console.warn('loadTriageOpsAlerts failed during boot', err);
  }

  try {
    await loadResearchCases({ render: false });
  } catch (err) {
    console.warn('loadResearchCases failed during boot', err);
  }

  try {
    await loadResearchWatchlist({ render: false });
  } catch (err) {
    console.warn('loadResearchWatchlist failed during boot', err);
  }

  try {
    await loadResearchDiscovery({ render: false });
  } catch (err) {
    console.warn('loadResearchDiscovery failed during boot', err);
  }

  try {
    await loadCoverage({ render: false });
  } catch (err) {
    console.warn('loadCoverage failed during boot', err);
  }

  try {
    await loadCampaignFixtures({ render: false });
  } catch (err) {
    console.warn('loadCampaignFixtures failed during boot', err);
  }

  renderAll();
  loadIntelligence().catch(err => console.warn('deferred intelligence status failed', err));
  startNativeEventStream();
  startLiveExecutionRefreshLoop();

  if (errors.length) {
    setStatus(`Dashboard loaded with partial data • ${escapeHtml(errors[0])}`, true);
  }
}

function bindEvents() {
  el('auth-login-form')?.addEventListener('submit', signInOperator);
  el('auth-reset-request-btn')?.addEventListener('click', requestPasswordReset);
  el('auth-update-form')?.addEventListener('submit', updateRecoveredPassword);
  el('auth-signout-btn')?.addEventListener('click', signOutOperator);
  document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => togglePrimarySectionNavigation(btn)));
  el('mobile-menu-btn')?.addEventListener('click', toggleMobileNav);
  el('work-table-view-btn')?.addEventListener('click', () => { workView = 'table'; renderTasks(); });
  el('work-board-view-btn')?.addEventListener('click', () => { workView = 'board'; renderTasks(); });
  el('specialist-refresh-btn')?.addEventListener('click', event => runRefreshAction(event.currentTarget, () => loadSpecialists(), { successMessage: 'Specialist Orchestrator refreshed' }));
  el('specialist-policy-mode')?.addEventListener('change', event => {
    state.specialists.policyDirty = true;
    if (el('specialist-policy-tier')) el('specialist-policy-tier').disabled = event.currentTarget.value !== 'guarded';
  });
  el('specialist-policy-tier')?.addEventListener('change', () => {
    state.specialists.policyDirty = true;
  });
  el('specialist-policy-save-btn')?.addEventListener('click', event => saveSpecialistPolicy(event.currentTarget));
  el('specialist-route-next-btn')?.addEventListener('click', event => autoRouteNextWorkItem(event.currentTarget));
  el('top-search-btn')?.addEventListener('click', openCommandPalette);
  el('top-help-btn')?.addEventListener('click', () => openHelpDrawer(currentPageFromLocation()));
  el('top-health-btn')?.addEventListener('click', () => setPage('integrations', { routeOverride: SYSTEM_VIEW_ROUTES.health }));
  el('workspace-switcher')?.addEventListener('click', () => showToast('This pilot uses one authenticated SecOpsAI workspace. Customer/site switching is available when multi-tenant workspaces are enabled.', 'info'));
  el('enterprise-refresh-btn')?.addEventListener('click', event => runRefreshAction(event.currentTarget, () => loadEnterpriseStatus(), { successMessage: 'Enterprise status refreshed' }));
  document.querySelectorAll('[data-enterprise-tab]').forEach(button => button.addEventListener('click', () => selectEnterpriseTab(button.dataset.enterpriseTab)));
  document.querySelectorAll('[data-enterprise-assessment]').forEach(button => button.addEventListener('click', () => selectEnterpriseAssessment(button.dataset.enterpriseAssessment)));
  el('enterprise-configure-source-btn')?.addEventListener('click', () => {
    if ((enterpriseStatusResult().store || {}).status !== 'ready') setPage('integrations', { routeOverride: SYSTEM_VIEW_ROUTES.health });
    else openEnterpriseImport();
  });
  el('enterprise-import-toggle-btn')?.addEventListener('click', () => openEnterpriseImport());
  el('enterprise-open-guide-btn')?.addEventListener('click', () => {
    setPage('operator-guide');
    window.setTimeout(() => el('guide-enterprise')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  });
  el('enterprise-connector-list')?.addEventListener('click', event => {
    const importButton = event.target.closest('[data-enterprise-import-source]');
    if (importButton) openEnterpriseImport(importButton.dataset.enterpriseImportSource);
    if (event.target.closest('[data-enterprise-open-system]')) setPage('integrations', { routeOverride: SYSTEM_VIEW_ROUTES.integrations });
  });
  el('enterprise-next-actions')?.addEventListener('click', event => {
    const target = event.target.closest('[data-enterprise-target]')?.dataset.enterpriseTarget;
    if (target === 'system') setPage('integrations', { routeOverride: SYSTEM_VIEW_ROUTES.health });
    else if (target === 'source') openEnterpriseImport();
    else if (target === 'vulnerability') selectEnterpriseAssessment('vulnerability');
    else if (target === 'govern') selectEnterpriseTab('govern');
  });
  el('enterprise-event-filter')?.addEventListener('change', event => { state.enterprise.eventFilter = event.currentTarget.value; renderEnterprise(); });
  el('enterprise-ingest-btn')?.addEventListener('click', async event => {
    let events;
    try {
      const parsed = JSON.parse(el('enterprise-ingest-json')?.value || '');
      events = Array.isArray(parsed) ? parsed : [parsed];
      if (!events.length || events.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('Use one JSON event object or an array of event objects.');
    } catch (error) {
      setEnterpriseOutput('enterprise-ingest-output', { tone: 'danger', title: 'Event JSON is invalid', summary: error?.message || String(error), details: ['Nothing was imported.'] });
      return;
    }
    await runEnterpriseAction('ingest-events', { source: el('enterprise-ingest-source')?.value || '', events }, event.currentTarget, 'enterprise-ingest-output');
  });
  el('enterprise-vuln-run-btn')?.addEventListener('click', event => runEnterpriseAction('prioritize-vulnerability', {
    advisory_id: el('enterprise-vuln-advisory')?.value?.trim() || '',
    package_name: el('enterprise-vuln-package')?.value?.trim() || '',
    package_version: el('enterprise-vuln-version')?.value?.trim() || '',
    asset_id: el('enterprise-vuln-asset')?.value?.trim() || '',
    cvss_score: Number(el('enterprise-vuln-cvss')?.value || 0),
    exploitability_score: Number(el('enterprise-vuln-exploitability')?.value || 0),
    asset_criticality: el('enterprise-vuln-criticality')?.value || 'normal',
    kev: Boolean(el('enterprise-vuln-kev')?.checked),
    active_exploitation: Boolean(el('enterprise-vuln-active')?.checked),
    internet_exposed: Boolean(el('enterprise-vuln-exposed')?.checked),
  }, event.currentTarget, 'enterprise-vuln-output'));
  el('enterprise-kubernetes-run-btn')?.addEventListener('click', event => runEnterpriseAction('kubernetes-scan', { manifest: el('enterprise-kubernetes-manifest')?.value || '' }, event.currentTarget, 'enterprise-kubernetes-output'));
  el('enterprise-dast-run-btn')?.addEventListener('click', event => runEnterpriseAction('dast-validate', {
    target_id: el('enterprise-dast-target-id')?.value?.trim() || '',
    url: el('enterprise-dast-url')?.value?.trim() || '',
    owner: el('enterprise-dast-owner')?.value?.trim() || '',
    authorized_by: el('enterprise-dast-authorization')?.value?.trim() || '',
    mode: el('enterprise-dast-mode')?.value || 'passive',
    active_approved: Boolean(el('enterprise-dast-approved')?.checked),
  }, event.currentTarget, 'enterprise-dast-output'));
  el('enterprise-control-save-btn')?.addEventListener('click', event => runEnterpriseAction('control', {
    control_id: el('enterprise-control-id')?.value?.trim() || '',
    framework: el('enterprise-control-framework')?.value || '',
    title: el('enterprise-control-title')?.value?.trim() || '',
    owner: el('enterprise-control-owner')?.value?.trim() || '',
    status: el('enterprise-control-status')?.value || 'not_started',
  }, event.currentTarget, 'enterprise-control-output'));
  el('enterprise-workflow-kind')?.addEventListener('change', () => renderEnterprise());
  el('enterprise-workflow-save-btn')?.addEventListener('click', event => runEnterpriseAction('workflow', enterpriseWorkflowRecord(), event.currentTarget, 'enterprise-workflow-output'));
  el('enterprise-open-research-pipeline-btn')?.addEventListener('click', () => setPage('automation', { routeOverride: AUTOMATION_VIEW_ROUTES.research, scrollToTarget: false }));
  el('artifact-fleet-refresh-btn')?.addEventListener('click', event => runRefreshAction(event.currentTarget, () => loadArtifactFleetStatus(), { successMessage: 'Artifact Fleet status refreshed' }));
  el('source-research-preview-btn')?.addEventListener('click', event => runSourceFirstResearchAction('preview', event.currentTarget));
  el('source-research-run-btn')?.addEventListener('click', event => runSourceFirstResearchAction('run', event.currentTarget));
  el('source-research-matrix-btn')?.addEventListener('click', event => runSourceResearchFollowup('matrix', event.currentTarget));
  el('source-research-queue-btn')?.addEventListener('click', event => runSourceResearchFollowup('queue', event.currentTarget));
  el('source-research-draft-btn')?.addEventListener('click', event => runSourceResearchFollowup('draft', event.currentTarget));
  el('source-research-open-case-btn')?.addEventListener('click', event => runSourceResearchFollowup('open-case', event.currentTarget));
  el('source-research-copy-btn')?.addEventListener('click', event => runSourceResearchFollowup('copy-cli', event.currentTarget));
  el('source-research-ecosystem')?.addEventListener('change', updateSourceResearchForm);
  updateSourceResearchForm();
  document.querySelectorAll('[data-artifact-fleet-action]').forEach(button => {
    button.addEventListener('click', event => runArtifactFleetAction(event.currentTarget.dataset.artifactFleetAction, {}, event.currentTarget));
  });
  el('confirm-dialog-confirm')?.addEventListener('click', () => finishConfirmation(true));
  el('confirm-dialog-cancel')?.addEventListener('click', () => finishConfirmation(false));
  el('confirm-dialog-close')?.addEventListener('click', () => finishConfirmation(false));
  el('confirm-dialog')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) finishConfirmation(false);
  });
  el('intelligence-result-close')?.addEventListener('click', closeIntelligenceResult);
  el('intelligence-result-done')?.addEventListener('click', closeIntelligenceResult);
  el('intelligence-result-modal')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeIntelligenceResult();
  });
  el('intelligence-result-copy')?.addEventListener('click', async () => {
    const job = intelligenceJobs().find(item => item.job_id === state.intelligence.selectedJobId);
    if (job) await copyTextWithStatus(intelligenceResultMarkdown(job), 'Full model analysis copied');
  });
  el('intelligence-result-open-case')?.addEventListener('click', openIntelligenceResearchCase);
  el('command-palette-close')?.addEventListener('click', closeCommandPalette);
  el('command-palette-input')?.addEventListener('input', event => {
    commandPaletteIndex = 0;
    renderCommandPalette(event.target.value);
  });
  el('command-palette')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeCommandPalette();
  });
  el('help-drawer-close')?.addEventListener('click', closeHelpDrawer);
  document.addEventListener('keydown', event => {
    const confirmation = el('confirm-dialog');
    if (confirmation && !confirmation.classList.contains('hidden')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        finishConfirmation(false);
      }
      return;
    }
    const intelligenceResult = el('intelligence-result-modal');
    if (intelligenceResult && !intelligenceResult.classList.contains('hidden') && event.key === 'Escape') {
      event.preventDefault();
      closeIntelligenceResult();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openCommandPalette();
      return;
    }
    const palette = el('command-palette');
    if (palette && !palette.classList.contains('hidden')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCommandPalette();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = [...document.querySelectorAll('#command-palette-list .command-item')];
        if (!items.length) return;
        commandPaletteIndex = (commandPaletteIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        renderCommandPalette(el('command-palette-input')?.value || '');
      } else if (event.key === 'Enter') {
        const selected = document.querySelector('#command-palette-list .command-item.selected');
        if (selected) selected.click();
      }
    } else if (event.key === 'Escape') {
      if (document.body.classList.contains('finding-review-open')) closeFindingReview();
      closeHelpDrawer();
    }
  });
  el('refresh-btn')?.addEventListener('click', async () => {
    if (bootError) {
      setStatus(bootError, true);
      return;
    }
    setStatus('<span class="dot"></span> Refreshing dashboard data…');
    await runRefreshAction('refresh-btn', refreshOperationalWorkspace, {
      busyLabel: '<span class="dot"></span> Refreshing…',
      successMessage: 'Overview data refreshed'
    });
  });
  el('new-task-btn')?.addEventListener('click', () => {
    if (bootError) {
      setStatus(bootError, true);
      return;
    }
    openTaskModal();
  });
  el('new-finding-task-btn')?.addEventListener('click', () => {
    if (bootError) {
      setStatus(bootError, true);
      return;
    }
    openFindingTaskModal();
  });
  el('finding-review-close-btn')?.addEventListener('click', closeFindingReview);
  el('edge-refresh-btn')?.addEventListener('click', async (event) => {
    await runRefreshAction(event.currentTarget, () => loadEdgeWorkspace(), {
      busyLabel: '<span class="dot"></span> Refreshing…',
      successMessage: 'Assets and sensors refreshed'
    });
  });
  el('intelligence-refresh-btn')?.addEventListener('click', async event => {
    await runRefreshAction(event.currentTarget, () => loadIntelligence(), {
      successMessage: 'Model assistance status refreshed'
    });
  });
  el('intelligence-action-select')?.addEventListener('change', syncIntelligenceTarget);
  el('intelligence-target-id')?.addEventListener('input', event => { event.currentTarget.dataset.suggested = '0'; });
  el('intelligence-queue-btn')?.addEventListener('click', async event => {
    const action = el('intelligence-action-select')?.value || 'prioritize_findings';
    const targetId = el('intelligence-target-id')?.value?.trim() || '';
    if (intelligenceActionNeedsTarget(action) && !targetId) {
      showToast('Select or enter the SecOpsAI record ID required by this action.', 'error');
      el('intelligence-target-id')?.focus();
      return;
    }
    await runIntelligenceAction('enqueue', { intelligence_action: action, target_id: targetId }, event.currentTarget);
  });
  document.querySelectorAll('[data-automation-tab]').forEach(button => button.addEventListener('click', () => {
    const view = button.dataset.automationTab || 'models';
    state.intelligence.view = view;
    setPage('automation', { routeOverride: AUTOMATION_VIEW_ROUTES[view] || AUTOMATION_VIEW_ROUTES.models, scrollToTarget: false });
    if (view === 'research' && !state.artifactFleet.data && !state.artifactFleet.loading) loadArtifactFleetStatus();
  }));
  el('intelligence-model-select')?.addEventListener('change', async event => {
    const selectedModel = event.currentTarget.value || '';
    state.intelligence.pendingSelectedModel = selectedModel;
    state.intelligence.selectedModel = selectedModel;
    state.intelligence.fallbackModels = state.intelligence.fallbackModels.filter(model => model !== selectedModel);
    state.intelligence.routingDirty = true;
    if (selectedModel) sessionStorage.setItem('secopsai_bridge_model', selectedModel);
    renderIntelligenceModelSelect();
    if (selectedModel) await saveIntelligenceRouting();
  });
  el('intelligence-fallback-mode')?.addEventListener('change', event => {
    state.intelligence.fallbackMode = event.currentTarget.value || 'disabled';
    state.intelligence.routingDirty = true;
    renderIntelligenceRouting();
  });
  el('intelligence-model-search')?.addEventListener('input', event => {
    state.intelligence.modelSearch = event.currentTarget.value || '';
    renderIntelligenceRouting();
  });
  el('intelligence-model-catalog')?.addEventListener('change', event => {
    const checkbox = event.target.closest?.('[data-routing-fallback]');
    if (checkbox) setRoutingFallback(checkbox.dataset.routingFallback, checkbox.checked);
  });
  el('intelligence-fallback-order')?.addEventListener('click', event => {
    const remove = event.target.closest?.('[data-routing-remove]');
    if (remove) return setRoutingFallback(remove.dataset.routingRemove, false);
    const move = event.target.closest?.('[data-routing-move]');
    if (!move) return;
    const model = move.dataset.routingModel;
    const index = state.intelligence.fallbackModels.indexOf(model);
    const target = move.dataset.routingMove === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= state.intelligence.fallbackModels.length) return;
    [state.intelligence.fallbackModels[index], state.intelligence.fallbackModels[target]] = [state.intelligence.fallbackModels[target], state.intelligence.fallbackModels[index]];
    state.intelligence.routingDirty = true;
    renderIntelligenceRouting();
  });
  el('intelligence-routing-save-btn')?.addEventListener('click', event => saveIntelligenceRouting(event.currentTarget));
  el('intelligence-routing-recommended-btn')?.addEventListener('click', () => {
    const primary = intelligenceSelectedModel();
    const recommended = Array.isArray(state.intelligence.data?.bridge?.recommended_fallback_models)
      ? state.intelligence.data.bridge.recommended_fallback_models
      : [];
    const available = new Set(intelligenceModels().map(item => String(item.id || '')));
    state.intelligence.fallbackModels = recommended.filter(model => model !== primary && available.has(model)).slice(0, 6);
    state.intelligence.fallbackMode = state.intelligence.fallbackModels.length ? 'quota_auth' : 'disabled';
    state.intelligence.routingDirty = true;
    renderIntelligenceRouting();
  });
  el('intelligence-routing-clear-btn')?.addEventListener('click', () => {
    state.intelligence.fallbackModels = [];
    state.intelligence.fallbackMode = 'disabled';
    state.intelligence.routingDirty = true;
    renderIntelligenceRouting();
  });
  el('intelligence-run-once-btn')?.addEventListener('click', event => {
    const model = el('intelligence-model-select')?.value || '';
    runIntelligenceAction('run-once', model ? { model } : {}, event.currentTarget);
  });
  el('intelligence-autopilot-save')?.addEventListener('click', async event => {
    const mode = el('intelligence-autopilot-mode')?.value || 'advisory';
    const model = el('intelligence-autopilot-model')?.value || '';
    const minAutoCloseConfidence = Number(el('intelligence-autopilot-confidence')?.value || 97);
    const minEvidenceRefs = Number(el('intelligence-autopilot-evidence')?.value || 2);
    const maxRecordsPerCycle = Number(el('intelligence-autopilot-limit')?.value || 10);
    const autoCreateTuningProposals = Boolean(el('intelligence-autopilot-tuning')?.checked);
    const autoActivateTuning = Boolean(el('intelligence-autopilot-activate-tuning')?.checked);
    if (mode === 'guarded' && !(await requestConfirmation(
      `Enable guarded autonomous triage with ${model || 'the provider default'}?`,
      {
        title: 'Enable guarded triage',
        context: `The model may auto-close only when independent deterministic evidence supports the same benign disposition. Every decision remains logged and reversible.${autoActivateTuning ? ' Threshold tuning can activate only after high-confidence historical replay proves the exact change; rule condition and weight changes stay shadow-only.' : ''} Publication, disclosure, external sandbox submission, and destructive response remain separately controlled.`,
        confirmLabel: 'Save guarded policy'
      },
    ))) return;
    await runIntelligenceAction('autopilot-configure', {
      mode,
      model,
      min_auto_close_confidence: minAutoCloseConfidence,
      min_evidence_refs: minEvidenceRefs,
      max_records_per_cycle: maxRecordsPerCycle,
      auto_create_tuning_proposals: autoCreateTuningProposals,
      auto_activate_tuning: autoActivateTuning
    }, event.currentTarget);
  });
  el('intelligence-autopilot-run')?.addEventListener('click', event => {
    runIntelligenceAction('autopilot-run-now', {}, event.currentTarget);
  });
  el('intelligence-autopilot-runs')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-agent-triage-rollback]');
    if (!button) return;
    const runId = button.dataset.agentTriageRollback;
    if (!(await requestConfirmation(`Rollback autonomous triage decision ${runId}?`, {
      title: 'Rollback triage decision',
      context: 'SecOpsAI will restore the finding status and disposition captured before the model-assisted decision and record the rollback in the audit trail.',
      confirmLabel: 'Rollback decision'
    }))) return;
    await runIntelligenceAction('autopilot-rollback', { run_id: runId }, button);
  });
  el('intelligence-autopilot-proposals')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-agent-tuning-rollback]');
    if (!button) return;
    const proposalId = button.dataset.agentTuningRollback;
    if (!(await requestConfirmation(`Rollback active threshold tuning ${proposalId}?`, {
      title: 'Rollback threshold tuning',
      context: 'SecOpsAI will restore the deterministic baseline threshold captured before activation and retain the full replay history.',
      confirmLabel: 'Rollback tuning'
    }))) return;
    await runIntelligenceAction('autopilot-rollback-tuning', { proposal_id: proposalId }, button);
  });
  el('investigation-run-due')?.addEventListener('click', event => {
    runIntelligenceAction('investigation-run-due', {}, event.currentTarget);
  });
  el('investigation-autopilot-runs')?.addEventListener('click', async event => {
    const retry = event.target.closest('[data-investigation-retry]');
    const cancel = event.target.closest('[data-investigation-cancel]');
    const openCase = event.target.closest('[data-investigation-case]');
    if (openCase) {
      await openResearchCase(openCase.dataset.investigationCase);
      return;
    }
    if (retry) await runIntelligenceAction('investigation-retry', { run_id: retry.dataset.investigationRetry }, retry);
    if (cancel && await requestConfirmation('Cancel this evidence investigation?', { title: 'Cancel investigation', context: 'Collected evidence remains in quarantine and the run can be retried.', confirmLabel: 'Cancel investigation' })) {
      await runIntelligenceAction('investigation-cancel', { run_id: cancel.dataset.investigationCancel }, cancel);
    }
  });
  el('detection-learning-run')?.addEventListener('click', event => runIntelligenceAction('learning-run-cycle', {}, event.currentTarget));
  el('daily-automation-save')?.addEventListener('click', async event => {
    await runIntelligenceAction('daily-configure', {
      enabled: el('daily-automation-enabled')?.value === 'on',
      interval_seconds: Number(el('daily-automation-interval')?.value || 86400),
      max_alert_reviews: Number(el('daily-automation-alert-limit')?.value || 25),
      max_investigations: Number(el('daily-automation-investigation-limit')?.value || 5),
      max_candidate_cases: Number(el('daily-automation-case-limit')?.value || 25),
      auto_promote_candidates: Boolean(el('daily-automation-promote')?.checked),
      run_learning: Boolean(el('daily-automation-learning')?.checked)
    }, event.currentTarget);
  });
  el('daily-automation-run')?.addEventListener('click', async event => {
    await runIntelligenceAction('daily-run', {}, event.currentTarget);
  });
  const handleLearningProposalClick = async event => {
    const deploy = event.target.closest('[data-learning-deploy]'); const rollback = event.target.closest('[data-learning-rollback]');
    if (deploy) await runIntelligenceAction('learning-deploy', { proposal_id: deploy.dataset.learningDeploy, stage: deploy.dataset.learningStage }, deploy);
    if (rollback && await requestConfirmation('Rollback this learned detection policy?', { title: 'Rollback learned policy', context: 'SecOpsAI will stop active shadow or canary evaluation and preserve the experiment and observations for audit.', confirmLabel: 'Rollback policy' })) await runIntelligenceAction('learning-rollback', { proposal_id: rollback.dataset.learningRollback }, rollback);
  };
  el('detection-learning-current')?.addEventListener('click', handleLearningProposalClick);
  el('detection-learning-proposals')?.addEventListener('click', handleLearningProposalClick);
  el('detection-learning-deployments')?.addEventListener('click', handleLearningProposalClick);
  el('detection-learning-adjudication')?.addEventListener('click', event => {
    const review = event.target.closest('[data-learning-review-finding]');
    if (!review) return;
    selectFinding(review.dataset.learningReviewFinding);
    setPage('findings');
  });
  document.querySelectorAll('[data-intelligence-service]').forEach(button => button.addEventListener('click', async event => {
    const serviceAction = event.currentTarget.dataset.intelligenceService;
    const model = el('intelligence-model-select')?.value || '';
    if (serviceAction === 'install' && !(await requestConfirmation(
      `Install the local bridge in guarded agent-review mode${model ? ` using ${model}` : ''}? The selected model will persist across browser and workstation restarts.`,
      { title: 'Install autonomous local bridge', context: 'The service may complete bounded evidence review and record guarded verdicts. It cannot execute packages, send disclosure, submit external sandbox artifacts, change customer controls, or publish content.', confirmLabel: 'Install service' },
    ))) return;
    await runIntelligenceAction('service', serviceAction === 'install' ? { service_action: serviceAction, model } : { service_action: serviceAction }, event.currentTarget);
  }));
  el('intelligence-copy-mcp-btn')?.addEventListener('click', async () => {
    const url = state.intelligence.data?.chatgpt_app?.url || '';
    if (url) await copyTextWithStatus(url, 'ChatGPT app MCP URL copied');
  });
  el('intelligence-jobs-table')?.addEventListener('click', event => {
    const reviewButton = event.target.closest('[data-intelligence-review]');
    if (reviewButton) {
      openIntelligenceResult(reviewButton.dataset.intelligenceReview);
      return;
    }
    const cancelButton = event.target.closest('[data-intelligence-cancel]');
    if (cancelButton) {
      runIntelligenceAction('cancel', { job_id: cancelButton.dataset.intelligenceCancel }, cancelButton);
      return;
    }
    const requeueButton = event.target.closest('[data-intelligence-requeue]');
    if (!requeueButton) return;
    runIntelligenceAction('requeue', { job_id: requeueButton.dataset.intelligenceRequeue }, requeueButton);
  });
  el('intelligence-recover-transient-btn')?.addEventListener('click', event => {
    runIntelligenceAction('recover-transient-jobs', { limit: 10, max_attempts: 3, min_age_seconds: 300 }, event.currentTarget);
  });
  el('task-modal-close')?.addEventListener('click', closeTaskModal);
  el('task-cancel-btn')?.addEventListener('click', closeTaskModal);
  el('task-save-btn')?.addEventListener('click', () => saveTask());
  el('task-save-run-btn')?.addEventListener('click', () => saveTask({ runAfterSave: true }));
  const taskDeleteBtn = el('task-delete-btn');
  if (taskDeleteBtn && taskDeleteBtn.dataset.bound !== '1') {
    taskDeleteBtn.dataset.bound = '1';
    taskDeleteBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await deleteTask();
      } catch (e) {
        console.error('deleteTask click failed', e);
    notifyError(`Delete failed: ${e?.message || e}`);
      }
    });
  }
  el('task-assign-owner-btn')?.addEventListener('click', assignSuggestedOwnerFromModal);
  el('task-assign-reviewer-btn')?.addEventListener('click', assignSuggestedReviewerFromModal);
  el('task-generate-prompt-btn')?.addEventListener('click', () => {
    const item = state.workItems.find(w => w.id === taskModalState.editingId) || {
      title: el('task-title')?.value?.trim() || '',
      domain: el('task-domain')?.value || 'exec',
      priority: el('task-priority')?.value || 'normal',
      status: el('task-status')?.value || 'inbox',
      owner_role: el('task-owner-role')?.value?.trim() || null,
      reviewer_role: el('task-reviewer-role')?.value?.trim() || null,
      description: el('task-description')?.value?.trim() || ''
    };
    openPromptModal(item);
  });
  el('prompt-modal-close')?.addEventListener('click', closePromptModal);
  el('prompt-close-btn')?.addEventListener('click', closePromptModal);
  el('prompt-copy-btn')?.addEventListener('click', copyPromptToClipboard);
  el('prompt-run-btn')?.addEventListener('click', runPromptNow);
  el('prompt-specialist-route-btn')?.addEventListener('click', event => routePromptSpecialist(event.currentTarget));
  el('prompt-specialist-create-btn')?.addEventListener('click', event => createPromptSpecialistRun(event.currentTarget));
  el('prompt-specialist-refresh-run-btn')?.addEventListener('click', event => runRefreshAction(event.currentTarget, () => refreshPromptSpecialistRun(), { successMessage: 'Specialist run refreshed' }));
  el('prompt-specialist-approve-btn')?.addEventListener('click', event => mutatePromptSpecialistRun('approve', event.currentTarget));
  el('prompt-specialist-execute-btn')?.addEventListener('click', event => mutatePromptSpecialistRun('execute', event.currentTarget));
  el('prompt-specialist-cancel-btn')?.addEventListener('click', event => mutatePromptSpecialistRun('cancel', event.currentTarget));
  ['prompt-specialist-select', 'prompt-specialist-tier'].forEach(id => el(id)?.addEventListener('change', () => routePromptSpecialist(el('prompt-specialist-route-btn'))));
  el('prompt-mode-select')?.addEventListener('change', (event) => {
    promptModalState.mode = event?.target?.value || 'smart-local';
    refreshPromptBrief();
  });
  el('blog-edit-modal-close')?.addEventListener('click', closeBlogEditModal);
  el('blog-edit-cancel-btn')?.addEventListener('click', closeBlogEditModal);
  el('blog-edit-save-btn')?.addEventListener('click', (event) => saveBlogDraftEdit(event.currentTarget));
  ['task-filter-scope', 'task-search', 'task-filter-domain', 'task-filter-priority', 'task-filter-status', 'task-filter-owner', 'task-filter-reviewer'].forEach(id => {
    el(id)?.addEventListener('input', renderTasks);
    el(id)?.addEventListener('change', renderTasks);
  });
  ['task-filter-external', 'task-filter-security'].forEach(id => {
    el(id)?.addEventListener('change', renderTasks);
  });
  ['finding-search', 'finding-filter-severity', 'finding-filter-status', 'finding-filter-source'].forEach(id => {
    el(id)?.addEventListener('input', renderFindings);
    el(id)?.addEventListener('change', renderFindings);
  });
  el('finding-clear-filters-btn')?.addEventListener('click', () => {
    ['finding-search', 'finding-filter-severity', 'finding-filter-status', 'finding-filter-source'].forEach(id => { if (el(id)) el(id).value = ''; });
    renderFindings();
  });
  document.querySelectorAll('.finding-view-btn').forEach(button => button.addEventListener('click', () => {
    const view = button.dataset.findingView;
    applyFindingSavedView(view, { persist: true });
    renderFindings();
  }));
  el('triage-ops-save-token-btn')?.addEventListener('click', () => {
    state.triageOps.adminToken = el('triage-ops-admin-token')?.value || '';
    state.researchCases.adminToken = state.triageOps.adminToken;
    if (state.triageOps.adminToken) {
      sessionStorage.setItem('secopsai_triage_ops_admin_token', state.triageOps.adminToken);
      setStatus('<span class="dot"></span> Triage Ops admin token stored for this browser session');
    } else {
      sessionStorage.removeItem('secopsai_triage_ops_admin_token');
      setStatus('Triage Ops admin token cleared');
    }
    renderTriageOps();
    renderResearchCases();
  });
  el('triage-ops-clear-token-btn')?.addEventListener('click', () => {
    state.triageOps.adminToken = '';
    state.researchCases.adminToken = '';
    sessionStorage.removeItem('secopsai_triage_ops_admin_token');
    if (el('triage-ops-admin-token')) el('triage-ops-admin-token').value = '';
    renderTriageOps();
    renderResearchCases();
    setStatus('Triage Ops admin token cleared');
  });
  el('triage-ops-refresh-btn')?.addEventListener('click', async (event) => {
    await runTriageOpsAction('refresh-evidence', { button: event.currentTarget });
  });
  el('research-cases-new-btn')?.addEventListener('click', () => {
    const panel = el('research-case-create-panel');
    if (panel) {
      panel.open = true;
      el('research-create-title')?.focus();
    }
  });
  el('research-cases-refresh-btn')?.addEventListener('click', async event => {
    await runRefreshAction(event.currentTarget, () => loadResearchCases(), {
      successMessage: 'Research cases refreshed'
    });
  });
  el('research-sandbox-provider-verify-btn')?.addEventListener('click', event => {
    verifyResearchSandboxProvider(event.currentTarget);
  });
  el('research-content-packs-nav-btn')?.addEventListener('click', () => {
    const panel = el('research-content-packs-panel');
    if (panel) {
      panel.open = !panel.open;
      if (panel.open) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        loadContentPacks();
      }
    }
  });
  el('research-refresh-content-packs-btn')?.addEventListener('click', async event => {
    await runRefreshAction(event.currentTarget, () => loadContentPacks(), {
      successMessage: 'Social content packs refreshed'
    });
  });
  el('research-generate-content-pack-btn')?.addEventListener('click', async event => {
    const caseId = el('research-content-pack-case-id')?.value?.trim() || (state.researchCases.selected ? state.researchCases.selected.case_id : '');
    await generateContentPackForCase(caseId, event.currentTarget);
  });
  el('research-watchlist-refresh-btn')?.addEventListener('click', async event => {
    await runRefreshAction(event.currentTarget, () => loadResearchWatchlist(), {
      successMessage: 'Research watchlist refreshed'
    });
  });
  el('research-watchlist-preview-btn')?.addEventListener('click', async event => {
    const packages = selectedResearchWatchlistPackages();
    const selectAll = Boolean(el('research-watchlist-select-all')?.checked);
    const result = await runResearchWatchlistAction('preview', { packages, select_all: selectAll }, event.currentTarget);
    if (result) {
      state.researchCases.watchlist.result = result;
      renderResearchWatchlist();
    }
  });
  el('research-watchlist-create-btn')?.addEventListener('click', async event => {
    const packages = selectedResearchWatchlistPackages();
    const selectAll = Boolean(el('research-watchlist-select-all')?.checked);
    if (!selectAll && !packages.length) {
      setStatus('Select at least one npm watchlist package first.', true);
      return;
    }
    if (!(await requestConfirmation('Create draft Research Cases for the selected npm watchlist packages?', {
      title: 'Create research cases',
      context: 'Selected watchlist leads will become draft cases for human review. No publication or disclosure will occur.',
      confirmLabel: 'Create drafts'
    }))) return;
    const result = await runResearchWatchlistAction('create', { packages, select_all: selectAll }, event.currentTarget);
    if (result) {
      state.researchCases.watchlist.result = result;
      await loadResearchCases({ render: false, preserveSelection: true });
      renderResearchCases();
    }
  });
  el('research-discovery-refresh-btn')?.addEventListener('click', async event => {
    await runRefreshAction(event.currentTarget, () => loadResearchDiscovery(), {
      successMessage: 'Research discovery refreshed'
    });
  });
  el('research-inbox-refresh-btn')?.addEventListener('click', event => runRefreshAction(
    event.currentTarget,
    () => loadResearchDiscovery(),
    { successMessage: 'Discovery candidates refreshed', errorMessage: 'Candidate refresh failed' }
  ));
  el('research-discovery-ecosystem')?.addEventListener('change', syncResearchDiscoveryWatchlistOptions);
  el('research-discovery-add-watchlist-btn')?.addEventListener('click', event => runResearchDiscoveryAction('watchlist-add', {
    ecosystem: el('research-discovery-ecosystem')?.value || 'npm',
    watch_type: el('research-discovery-watch-type')?.value || 'package',
    identifier: el('research-discovery-identifier')?.value || '',
    threshold: Number(el('research-discovery-threshold')?.value || 70),
    reason: 'Added from Research discovery console'
  }, event.currentTarget));
  el('research-discovery-create-monitor-btn')?.addEventListener('click', event => {
    const ecosystem = el('research-discovery-ecosystem')?.value || 'npm';
    const watchlistId = el('research-discovery-watchlist-id')?.value || '';
    const watchlist = state.researchCases.discovery.watchlists.find(item => item.watchlist_id === watchlistId);
    if (!watchlist || watchlist.ecosystem !== ecosystem) {
      setStatus(`Select a ${escapeHtml(ecosystem)} watchlist before creating its monitor.`, true);
      return;
    }
    runResearchDiscoveryAction('monitor-create', {
      ecosystem,
      watchlist_id: watchlistId,
      interval_seconds: Number(el('research-discovery-interval')?.value || 3600),
      priority: 'normal'
    }, event.currentTarget);
  });
  el('research-discovery-run-due-btn')?.addEventListener('click', event => runResearchDiscoveryAction('monitor-run-due', { limit: 25 }, event.currentTarget));
  el('research-discovery-correlate-btn')?.addEventListener('click', event => runResearchDiscoveryAction('campaign-correlate', {}, event.currentTarget));
  el('research-campaigns-refresh-btn')?.addEventListener('click', event => runRefreshAction(event.currentTarget, () => loadResearchDiscovery(), {
    successMessage: 'Research campaigns refreshed'
  }));
  el('research-promotion-ecosystem')?.addEventListener('change', event => loadPromotionPolicyForEcosystem(event.currentTarget.value));
  el('research-promotion-save-btn')?.addEventListener('click', event => runResearchDiscoveryAction('promotion-policy-set', {
    ecosystem: el('research-promotion-ecosystem')?.value || 'all',
    enabled: Boolean(el('research-promotion-enabled')?.checked),
    score_threshold: Number(el('research-promotion-score')?.value || 90),
    minimum_evidence: Number(el('research-promotion-evidence')?.value || 2),
    require_publisher: Boolean(el('research-promotion-publisher')?.checked),
    mode: el('research-promotion-mode')?.value || 'draft_case'
  }, event.currentTarget));
  el('research-promotion-preview-btn')?.addEventListener('click', event => runResearchDiscoveryAction('promotion-policy-preview', { ecosystem: el('research-promotion-ecosystem')?.value || 'all', limit: 100 }, event.currentTarget));
  el('research-promotion-apply-btn')?.addEventListener('click', async event => {
    if (!(await requestConfirmation('Create draft research cases for every candidate that passes the saved deterministic promotion policy?', { title: 'Apply candidate promotion policy', context: 'This creates draft investigations only. It does not record a malicious verdict, send disclosure, or publish content.', confirmLabel: 'Create draft cases' }))) return;
    await runResearchDiscoveryAction('promotion-policy-apply', { ecosystem: el('research-promotion-ecosystem')?.value || 'all', limit: 100 }, event.currentTarget);
    await loadResearchCases({ render: false, preserveSelection: true });
    renderResearchCases();
  });
  el('research-discovery-candidates')?.addEventListener('click', async event => {
    const deliverBtn = event.target.closest('.research-alert-deliver-btn');
    const resolveBtn = event.target.closest('.research-alert-resolve-btn');
    if (deliverBtn) {
      await runResearchDiscoveryAction('alert-deliver', { alert_id: deliverBtn.dataset.alertId, channel: 'email' }, deliverBtn);
    } else if (resolveBtn) {
      if (!(await requestConfirmation(`Mark research alert ${resolveBtn.dataset.alertId} as resolved?`, {
        title: 'Resolve alert',
        confirmLabel: 'Resolve'
      }))) return;
      await runResearchDiscoveryAction('alert-resolve', { alert_id: resolveBtn.dataset.alertId }, resolveBtn);
    }
  });
  el('coverage-refresh-btn')?.addEventListener('click', event => runRefreshAction(event.currentTarget, () => loadCoverage(), {
    busyLabel: '<span class="dot"></span> Refreshing…',
    successMessage: 'Global coverage refreshed'
  }));
  el('coverage-score-run-btn')?.addEventListener('click', event => runCoverageAction('score-run', {}, event.currentTarget));
  el('coverage-retry-btn')?.addEventListener('click', event => runCoverageAction('collect-retry-failures', {}, event.currentTarget));
  el('coverage-collectors')?.addEventListener('click', event => {
    const runButton = event.target.closest('.coverage-run-btn');
    const toggleButton = event.target.closest('.coverage-toggle-btn');
    if (runButton) {
      runCoverageAction('collect-run', { ecosystem: runButton.dataset.ecosystem }, runButton);
    } else if (toggleButton) {
      const pause = toggleButton.dataset.enabled === '1';
      runCoverageAction(pause ? 'collect-pause' : 'collect-resume', { ecosystem: toggleButton.dataset.ecosystem }, toggleButton);
    }
  });
  el('research-cases-save-token-btn')?.addEventListener('click', () => {
    const token = el('research-cases-admin-token')?.value || '';
    state.researchCases.adminToken = token;
    state.triageOps.adminToken = token;
    if (token) sessionStorage.setItem('secopsai_triage_ops_admin_token', token);
    else sessionStorage.removeItem('secopsai_triage_ops_admin_token');
    renderResearchCases();
    setStatus(token ? '<span class="dot"></span> Protected research actions enabled for this browser session' : 'Research action token cleared');
  });
  el('research-cases-clear-token-btn')?.addEventListener('click', () => {
    state.researchCases.adminToken = '';
    state.triageOps.adminToken = '';
    sessionStorage.removeItem('secopsai_triage_ops_admin_token');
    if (el('research-cases-admin-token')) el('research-cases-admin-token').value = '';
    renderResearchCases();
    setStatus('Research action token cleared');
  });
  el('research-create-submit-btn')?.addEventListener('click', async event => {
    const result = await runResearchCaseAction('create', {
      title: el('research-create-title')?.value,
      summary: el('research-create-summary')?.value,
      case_type: el('research-create-type')?.value,
      severity: el('research-create-severity')?.value,
      potential_impact: el('research-create-impact')?.value,
      confidence: el('research-create-confidence')?.value,
      owner: el('research-create-owner')?.value
    }, event.currentTarget);
    if (result) {
      ['research-create-title', 'research-create-summary', 'research-create-owner'].forEach(id => { if (el(id)) el(id).value = ''; });
      if (el('research-create-confidence')) el('research-create-confidence').value = '0';
      if (el('research-case-create-panel')) el('research-case-create-panel').open = false;
    }
  });
  ['research-retract-close-btn', 'research-retract-cancel-btn'].forEach(id => el(id)?.addEventListener('click', closeResearchRetractModal));
  el('research-retract-confirm-btn')?.addEventListener('click', async event => {
    const target = state.researchCases.retractTarget;
    const reason = el('research-retract-reason')?.value?.trim() || '';
    if (!target || !reason) {
      setStatus('A retraction reason is required.', true);
      el('research-retract-reason')?.focus();
      return;
    }
    const result = await runResearchCaseAction('retract', {
      case_id: target.caseId,
      item_type: target.itemType,
      item_id: target.itemId,
      reason,
      actor: 'dashboard-operator'
    }, event.currentTarget);
    if (result) closeResearchRetractModal();
  });
  ['research-filter-status', 'research-filter-search'].forEach(id => {
    el(id)?.addEventListener('input', renderResearchCases);
    el(id)?.addEventListener('change', renderResearchCases);
  });
  ['guide-daily-refresh-btn', 'guide-daily-refresh-card-btn'].forEach(id => {
    el(id)?.addEventListener('click', event => runDailyGuideRefresh(event.currentTarget));
  });
  ['guide-evidence-bundle-btn', 'guide-evidence-bundle-card-btn'].forEach(id => {
    el(id)?.addEventListener('click', event => runTriageOpsEvidenceBundle(event.currentTarget));
  });
  el('guide-discovery-review-btn')?.addEventListener('click', event => runGuideDiscoveryReview(event.currentTarget));
  ['triage-ops-filter-status', 'triage-ops-filter-ecosystem', 'triage-ops-filter-actionability', 'triage-ops-filter-severity', 'triage-ops-filter-search'].forEach(id => {
    el(id)?.addEventListener('input', renderTriageOps);
    el(id)?.addEventListener('change', renderTriageOps);
  });
  el('blog-save-token-btn')?.addEventListener('click', () => {
    state.blogOps.adminToken = el('blog-admin-token')?.value || '';
    if (state.blogOps.adminToken) {
      sessionStorage.setItem('secopsai_blog_ops_admin_token', state.blogOps.adminToken);
      setStatus('<span class="dot"></span> Blog Ops admin token stored for this browser session');
    } else {
      sessionStorage.removeItem('secopsai_blog_ops_admin_token');
      setStatus('Blog Ops admin token cleared');
    }
    renderBlogOps();
  });
  el('blog-clear-token-btn')?.addEventListener('click', () => {
    state.blogOps.adminToken = '';
    sessionStorage.removeItem('secopsai_blog_ops_admin_token');
    if (el('blog-admin-token')) el('blog-admin-token').value = '';
    renderBlogOps();
    setStatus('Blog Ops admin token cleared');
  });
  el('blog-refresh-btn')?.addEventListener('click', async () => {
    await runRefreshAction('blog-refresh-btn', () => loadBlogOpsStatus(), {
      busyLabel: '<span class="dot"></span> Refreshing…',
      successMessage: 'Publications refreshed'
    });
  });
  el('blog-draft-filter')?.addEventListener('change', renderBlogOps);
  el('blog-content-filter')?.addEventListener('change', renderBlogOps);
  document.querySelectorAll('.publication-lane-btn').forEach(button => button.addEventListener('click', () => setPage('blog-ops', { routeOverride: button.dataset.publicationRoute })));
  document.querySelectorAll('.blog-action-btn').forEach(btn => {
    btn.addEventListener('click', () => runBlogOpsAction(btn.dataset.blogAction, { button: btn }));
  });
}

window.addEventListener('popstate', () => setPage(currentPageFromLocation(), { skipHistory: true }));
window.addEventListener('focus', () => refreshActiveSurface({ force: true }));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshActiveSurface({ force: true });
});

window.addEventListener('DOMContentLoaded', () => {
  const initialPage = currentPageFromLocation();
  collapseSidebarForInitialRoute(initialPage);
  setPage(initialPage, { skipHistory: true });
  bindEvents();
  restoreFindingSavedView();
  startTopStripClock();
  initializeDashboardAuth();
  enhanceResponsiveTables();
  const responsiveTableObserver = new MutationObserver(() => enhanceResponsiveTables());
  responsiveTableObserver.observe(document.body, { childList: true, subtree: true });
});

window.addEventListener('beforeunload', () => {
  stopDashboardRuntime();
  authSubscription?.unsubscribe();
});
