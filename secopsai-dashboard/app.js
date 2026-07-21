window.__SECOPSAI_APP_LOADED = true;
window.__SECOPSAI_DEBUG = { htmlLoaded: true, configLoaded: Boolean(window.SECOPSAI_CONFIG), appLoaded: true };

window.addEventListener('error', event => {
  const status = document.getElementById('global-status');
  if (status) status.textContent = `JS error: ${event.message || 'unknown error'}`;
});

window.addEventListener('unhandledrejection', event => {
  const status = document.getElementById('global-status');
  const reason = event.reason && (event.reason.message || String(event.reason));
  const lowerReason = String(reason || '').toLowerCase();
  if (lowerReason.includes('metamask') || lowerReason.includes('wallet') || lowerReason.includes('ethereum')) return;
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
  edgeWorkspace: {
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
  researchCases: {
    cases: [],
    selectedId: null,
    selected: null,
    loading: false,
    error: null,
    lastAction: null,
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
      loading: false,
      error: null,
      lastAction: null
    },
    adminToken: sessionStorage.getItem('secopsai_triage_ops_admin_token') || sessionStorage.getItem('secopsai_blog_ops_admin_token') || ''
  },
  localTriage: null,
  blogOps: {
    status: null,
    drafts: [],
    runs: [],
    selectedSlug: null,
    selectedDraft: null,
    loading: false,
    lastAction: null,
    adminToken: sessionStorage.getItem('secopsai_blog_ops_admin_token') || ''
  },
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
  selectedSessionId: null,
  selectedSessionDetail: null,
  nativeFindingOverrides: new Map(),
  outputEvidenceCache: new Map(),
  liveRefreshTimer: null,
  nativeEventSource: null,
  nativeStreamStatus: 'disconnected',
  nativeStreamLastEventAt: null,
  optionalTables: {
    findings: true,
    run_requests: true
  }
};

const taskModalState = { editingId: null, sourceFinding: null };
const promptModalState = { item: null, role: null, brief: null, mode: 'smart-local', runRequestId: null, relatedRunId: null, pollTimer: null, launchedFromTaskModal: false };
const dragState = { taskId: null };
let workView = 'table';
const pages = ["mission-control", "tasks", "findings", "edge", "integrations", "triage-ops", "research-cases", "coverage", "blog-ops", "operator-guide"];
const PAGE_ROUTES = Object.freeze({
  "mission-control": "overview",
  "tasks": "work",
  "findings": "findings",
  "edge": "assets",
  "integrations": "system",
  "triage-ops": "findings/supply-chain",
  "research-cases": "research/cases",
  "coverage": "research/coverage",
  "blog-ops": "publications",
  "operator-guide": "help"
});
const ROUTE_PAGES = Object.freeze(Object.fromEntries(Object.entries(PAGE_ROUTES).map(([page, route]) => [route, page])));
const TOP_NAV_PAGE = Object.freeze({
  "mission-control": "mission-control",
  "tasks": "tasks",
  "findings": "findings",
  "edge": "edge",
  "integrations": "integrations",
  "triage-ops": "findings",
  "research-cases": "research-cases",
  "coverage": "research-cases",
  "blog-ops": "blog-ops",
  "operator-guide": null
});
const PAGE_CONTEXT = {
  "mission-control": "Overview · operational priorities",
  "tasks": "Work · ownership, approvals, and runs",
  "findings": "Findings · security issues and triage",
  "edge": "Assets · inventory, sensors, and changes",
  "integrations": "System · health and integrations",
  "triage-ops": "Findings · supply-chain review",
  "research-cases": "Research · evidence and disclosure",
  "coverage": "Research · global registry surveillance",
  "blog-ops": "Publications · newsroom and delivery",
  "operator-guide": "Help · operator guidance"
};
const CONTEXT_NAV = Object.freeze({
  "mission-control": [],
  "findings": [
    ["All findings", "findings"],
    ["Supply chain", "triage-ops"],
    ["AI dependencies", "findings"]
  ],
  "edge": [
    ["Inventory", "edge"],
    ["Changes", "edge"],
    ["Sensors", "edge"],
    ["Scans & schedules", "edge"],
    ["Wi-Fi", "edge"]
  ],
  "tasks": [
    ["My work", "tasks"],
    ["Board", "tasks"],
    ["Approvals", "integrations"],
    ["Investigations", "integrations"],
    ["Runs", "integrations"]
  ],
  "research-cases": [
    ["Inbox", "triage-ops"],
    ["Cases", "research-cases"],
    ["Watchlists", "research-cases"],
    ["Global coverage", "coverage"],
    ["Disclosure", "research-cases"],
    ["Sandbox jobs", "research-cases"]
  ],
  "coverage": [
    ["Collectors", "coverage"],
    ["Feed events", "coverage"],
    ["Coverage windows", "coverage"],
    ["Candidates", "research-cases"],
    ["Cases", "research-cases"]
  ],
  "blog-ops": [
    ["News intake", "blog-ops"],
    ["Drafts", "blog-ops"],
    ["Review", "blog-ops"],
    ["Published", "blog-ops"]
  ],
  "integrations": [
    ["Health", "integrations"],
    ["Integrations", "integrations"],
    ["Credentials", "integrations"],
    ["Audit log", "integrations"]
  ],
  "triage-ops": [
    ["Supply-chain queue", "triage-ops"],
    ["Campaign research", "triage-ops"],
    ["Discovery inbox", "triage-ops"]
  ],
  "operator-guide": []
});
const COMMANDS = Object.freeze([
  ["Open Overview", "See priorities, changes, and system health", "mission-control"],
  ["Review Findings", "Triage canonical security issues", "findings"],
  ["Review Supply Chain", "Inspect package and dependency alerts", "triage-ops"],
  ["Open Assets", "Inspect network inventory and Edge sensors", "edge"],
  ["Open Work", "Manage tasks, approvals, and runs", "tasks"],
  ["Open Research", "Investigate leads and research cases", "research-cases"],
  ["Open Global Coverage", "Inspect registry collectors, cursor lag, and surveillance health", "coverage"],
  ["Open Publications", "Review and deliver public content", "blog-ops"],
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
    leaveAuthenticatedDashboard('Your operator session expired. Sign in again to continue.');
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
  setPage('mission-control');
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
  const line = String(result?.stdout || '').trim().split('\n').filter(Boolean).pop() || `Closed ${id}`;
  setStatus(`<span class="dot"></span> ${escapeHtml(line)}`);
  await loadLocalTriageState();
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

function setButtonBusy(buttonOrId, busy, busyLabel = 'Working…') {
  const btn = typeof buttonOrId === 'string' ? el(buttonOrId) : buttonOrId;
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.originalLabel) btn.dataset.originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.innerHTML = busyLabel;
  } else {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    if (btn.dataset.originalLabel) btn.innerHTML = btn.dataset.originalLabel;
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

function routeForPage(pageId) {
  return PAGE_ROUTES[pageId] || PAGE_ROUTES.mission-control;
}

function currentPageFromLocation() {
  return pageIdForRoute(window.location.hash || 'overview');
}

function renderContextNav(pageId) {
  const host = el('context-nav');
  if (!host) return;
  const items = CONTEXT_NAV[pageId] || [];
  const firstTargetIndex = new Map();
  items.forEach(([label, target], index) => { if (!firstTargetIndex.has(target)) firstTargetIndex.set(target, index); });
  host.innerHTML = items.map(([label, target], index) => `
    <button class="context-nav-btn ${target === pageId && firstTargetIndex.get(target) === index ? 'active' : ''}" type="button" data-context-page="${escapeHtml(target)}">${escapeHtml(label)}</button>
  `).join('');
  host.hidden = !items.length;
  host.querySelectorAll('[data-context-page]').forEach(button => {
    button.addEventListener('click', () => setPage(button.dataset.contextPage));
  });
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
    integrations: ['System', 'System explains the health of the dashboard, Core, Edge, helper, and action boundaries. Resolve degraded integrations before relying on their data.'],
    'operator-guide': ['Help', 'Use the operator guide for detailed click paths, safety boundaries, and recovery steps.']
  };
  return copies[pageId] || copies['mission-control'];
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

function setPage(pageId, { skipHistory = false } = {}) {
  const normalizedPageId = pages.includes(pageId) ? pageId : pageIdForRoute(pageId);
  pages.forEach((id) => {
    const page = el(`page-${id}`);
    if (page) page.classList.toggle("active", id === normalizedPageId);
  });
  const activeTopPage = TOP_NAV_PAGE[normalizedPageId] || normalizedPageId;
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === activeTopPage);
  });
  document.body.classList.remove('mobile-nav-open');
  el('mobile-menu-btn')?.setAttribute('aria-expanded', 'false');
  updateTopStrip(normalizedPageId);
  renderContextNav(normalizedPageId);
  if (!skipHistory && window.history?.pushState) {
    const nextHash = `#${routeForPage(normalizedPageId)}`;
    if (window.location.hash !== nextHash) window.history.pushState({ page: normalizedPageId }, '', nextHash);
  }
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
  return String(status || '').replace(/[_-]+/g, ' ');
}

function getTaskFilters() {
  return {
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

function filteredWorkItems() {
  const filters = getTaskFilters();
  return state.workItems.filter(item => {
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
  return finding?.id || finding?.finding_id || finding?.uuid || finding?.event_id || null;
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
      <div class="small" style="margin-top:12px;"><strong>CLI fallback:</strong> <code>${escapeHtml(aiDependencyGuardCliFallback())}</code></div>
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
    btn.textContent = 'Queued';
    btn.disabled = true;
    btn.classList.add('is-disabled-soft');
    return;
  }
  if (status === 'running' || status === 'picked_up') {
    btn.textContent = 'Running';
    btn.disabled = true;
    btn.classList.add('is-disabled-soft');
    return;
  }
  if (['completed','completed_with_gaps','needs_review','failed','cancelled'].includes(status)) {
    btn.textContent = 'Run again';
    return;
  }
  btn.textContent = 'Queue run';
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
  stopRunStatusPolling();

  el('prompt-modal-title').textContent = 'Work brief';
  const route = findRouteForRole(role);
  const reviewer = item?.reviewer_role || null;
  el('prompt-modal-meta').textContent = `Suggested owner: ${role}${reviewer ? ` • Reviewer: ${reviewer}` : ''}${route ? ` • Route metadata: #${route.channel_name}` : ''} • Direct dashboard-side sending retired`;
  if (el('prompt-mode-select')) el('prompt-mode-select').value = promptModalState.mode;
  refreshPromptBrief();
  syncPromptRunButtonState();
  setRunStatusUI({ status: 'idle', line: 'Not started', detail: '' });
  el('prompt-modal').classList.remove('hidden');
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
  const openFindingsForCockpit = sortedFindings().filter(finding => !['resolved', 'closed', 'done'].includes(String(findingStatus(finding)).toLowerCase()));
  const edgeWorkspaceReady = Boolean(state.edgeWorkspace.data) && !state.edgeWorkspace.error;
  const researchQueue = Array.isArray(state.researchCases.cases) ? state.researchCases.cases : [];
  const researchReady = researchQueue.filter(item => ['ready_to_publish', 'disclosure_pending', 'validation'].includes(String(item.status || '').toLowerCase())).length;

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
      <div class="card metric-card" data-drill="runs"><div class="metric">${activeRuns}</div><div class="metric-label">Active runs</div></div>
      <div class="card metric-card" data-drill="blocked"><div class="metric">${blocked}</div><div class="metric-label">Blocked items</div></div>
      <div class="card metric-card" data-drill="review"><div class="metric">${inReview}</div><div class="metric-label">In review</div></div>
      <div class="card metric-card" data-drill="done"><div class="metric">${doneToday}</div><div class="metric-label">Done today</div></div>
      <div class="card metric-card" data-drill="sec"><div class="metric">${secReview}</div><div class="metric-label">Needs security review</div></div>
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

  const byDomain = state.workItems.reduce((acc, item) => {
    acc[item.domain] = (acc[item.domain] || 0) + 1;
    return acc;
  }, {});
  const topDomains = Object.entries(byDomain).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const extFacing = state.workItems.filter(w => w.external_facing).length;
  const openFindings = sortedFindings().filter(f => !['resolved', 'closed', 'done'].includes(String(findingStatus(f)).toLowerCase())).length;
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

  const recentFeed = [...state.events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
  const eventsEl = el("mission-events");
  if (eventsEl) {
    eventsEl.innerHTML = recentFeed.length ? recentFeed.map(ev => `
      <div class="feed-item" style="border-left-color:${ev.severity === 'error' ? '#ef4444' : ev.severity === 'success' ? '#10b981' : ev.severity === 'warning' ? '#f59e0b' : '#06b6d4'}">
        <div><strong>${escapeHtml(ev.title)}</strong></div>
        <div class="small">${escapeHtml(ev.body || '')}</div>
        <div class="meta">${escapeHtml(ev.event_type)} • ${fmtDate(ev.created_at)}</div>
      </div>
    `).join("") : `<div class="empty">No dashboard events yet.</div>`;
  }

  const recentRuns = [...state.runs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
  const runsEl = el("mission-runs");
  if (runsEl) {
    runsEl.innerHTML = recentRuns.length ? recentRuns.map(run => `
      <div class="feed-item" style="border-left-color:${cfg.departments[roleDepartment(run.role_label)] || '#06b6d4'}">
        <div><strong>${escapeHtml(run.role_label)}</strong> — ${escapeHtml(run.task_summary)}</div>
        <div class="meta">${escapeHtml(run.status)} • ${escapeHtml(run.runtime || '—')} • ${fmtDate(run.created_at)}</div>
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
    if (filters.severity && severity !== filters.severity) return false;
    if (filters.status && status !== filters.status) return false;
    if (filters.source) {
      if (filters.source === 'secopsai_edge' && !source.includes('edge') && !String(finding.finding_id || '').toUpperCase().startsWith('EDGE-')) return false;
      if (filters.source === 'secopsai_core' && findingRecordOrigin(finding) !== 'core') return false;
      if (filters.source === 'ai_dependency_guard' && !source.includes('ai') && !source.includes('dependency')) return false;
    }
    if (filters.search) {
      const haystack = `${findingId(finding) || ''} ${findingTitle(finding)} ${findingBody(finding)} ${findingSource(finding)} ${findingValue(finding, 'asset') || ''}`.toLowerCase();
      if (!haystack.includes(filters.search)) return false;
    }
    return true;
  });
}

function renderTasks() {
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
  if (findingsAvailable && findings.length && !state.selectedFindingId) selectFinding();
  const triageSummary = localTriageSummary();
  const triageLatest = localTriageLatestRun();
  const pendingActions = localPendingActions();
  const openSessions = openLocalSessionsCount();
  const pendingApprovals = pendingLocalApprovalsCount();
  const summary = el('finding-summary');
  const total = findings.length;
  const aiGuardCount = aiDependencyGuardFindings(findings).length;
  const openCount = findings.filter(f => !['resolved', 'closed', 'done'].includes(String(findingStatus(f)).toLowerCase())).length;
  const criticalCount = findings.filter(f => ['critical', 'urgent'].includes(String(findingSeverity(f)).toLowerCase())).length;
  const linkedCount = findings.filter(f => relatedTasksForFinding(f).length > 0).length;
  const actionableCount = findings.filter(f => {
    const related = relatedTasksForFinding(f);
    return related.length === 0 || (related[0]?.item?.status && !['done', 'review'].includes(related[0].item.status));
  }).length;
  if (summary) {
    summary.innerHTML = `
      <div class="card"><div class="metric">${total}</div><div class="metric-label">Findings loaded</div></div>
      <div class="card"><div class="metric">${coreFindingCount}</div><div class="metric-label">Core canonical</div></div>
      <div class="card"><div class="metric">${dashboardFindingCount}</div><div class="metric-label">Dashboard operational</div></div>
      <div class="card"><div class="metric">${openCount}</div><div class="metric-label">Open / triageable</div></div>
      <div class="card"><div class="metric">${criticalCount}</div><div class="metric-label">Critical / urgent</div></div>
      <div class="card"><div class="metric">${aiGuardCount}</div><div class="metric-label">AI Dependency Guard risks</div></div>
      <div class="card"><div class="metric">${linkedCount}</div><div class="metric-label">With task correlation</div></div>
      <div class="card"><div class="metric">${actionableCount}</div><div class="metric-label">Needs action or follow-up</div></div>
      <div class="card"><div class="metric">${triageSummary ? triageSummary.open_findings ?? 0 : '—'}</div><div class="metric-label">Native SecOpsAI open findings</div></div>
      <div class="card"><div class="metric">${triageSummary ? triageSummary.pending_actions ?? pendingActions.length : '—'}</div><div class="metric-label">Native pending actions</div></div>
      <div class="card"><div class="metric">${openSessions}</div><div class="metric-label">Open investigation sessions</div></div>
      <div class="card"><div class="metric">${pendingApprovals}</div><div class="metric-label">Pending session approvals</div></div>
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
        <div class="table-wrap"><table>
          <thead><tr><th>Finding</th><th>Severity</th><th>Status</th><th>Correlation</th><th>Linked work</th><th>Actions</th></tr></thead>
          <tbody>${findings.map(f => {
            const related = relatedTasksForFinding(f);
            const best = related[0] || null;
            const normalizedFindingId = findingId(f);
            const selected = String(state.selectedFindingId) === String(normalizedFindingId);
            return `<tr class="finding-row ${selected ? 'selected-row' : ''}" data-finding-id="${escapeHtml(normalizedFindingId || '')}">
              <td><strong>${escapeHtml(findingTitle(f))}</strong><span class="finding-origin ${findingRecordOrigin(f)}">${findingRecordOrigin(f) === 'core' ? 'Core canonical' : 'Dashboard'}</span><div class="small">${escapeHtml(displayFindingSource(f))}${findingConfidence(f) !== null ? ` • confidence ${escapeHtml(findingConfidence(f))}` : ''}</div><div class="small">${escapeHtml(compactText(findingBody(f), 120))}</div></td>
              <td><span class="badge priority-${String(findingSeverity(f)).toLowerCase() === 'critical' ? 'urgent' : String(findingSeverity(f)).toLowerCase() === 'high' ? 'high' : 'normal'}">${escapeHtml(findingSeverity(f))}</span></td>
              <td>${renderStatusPill(String(effectiveFindingStatus(f)).toLowerCase(), humanizeSnake(effectiveFindingStatus(f)))}</td>
              <td>${best ? `<div class="small"><strong>${best.score}</strong> match</div><div class="small">${escapeHtml(best.reasons.join(' • '))}</div>` : '<span class="small">No strong match yet</span>'}</td>
              <td>${related.length ? related.slice(0, 2).map(match => `<div class="small">${escapeHtml(match.item.title)} <span class="muted-inline">(${escapeHtml(match.item.status || 'unknown')})</span></div>`).join('') : '<span class="small">No linked task yet</span>'}</td>
              <td><div class="task-card-actions"><button class="mini-btn finding-select-btn" data-finding-id="${escapeHtml(normalizedFindingId || '')}">Inspect</button><button class="mini-btn finding-task-btn" data-finding-id="${escapeHtml(normalizedFindingId || '')}">Create task</button><button class="mini-btn finding-run-investigate-btn" data-finding-id="${escapeHtml(normalizedFindingId || '')}">Investigate now</button><button class="mini-btn finding-copy-investigate-btn" data-finding-id="${escapeHtml(normalizedFindingId || '')}">Copy investigate</button></div></td>
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
    const requests = correlatedRunRequestsForFinding(selected);
    const nativeInsight = localFindingInsight(findingId(selected));
    const findingSessions = sessionsForFinding(selected);
    const latestSession = findingSessions[0] || null;
    const sessionApprovals = pendingApprovalsForSession(latestSession);
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
                  <option value="needs_review">Needs Review</option>
                  <option value="tune_policy">Tune Policy</option>
                  <option value="expected_behavior">Expected Behavior</option>
                  <option value="false_positive">False Positive</option>
                </select>
              </label>
              <label class="full">
                <span>Analyst note</span>
                <textarea id="selected-finding-close-note" rows="3" placeholder="Explain why this finding should be closed in native SecOpsAI."></textarea>
              </label>
            </div>
            <div class="task-card-actions" style="margin-top:14px;">
              <button class="mini-btn" id="selected-finding-run-close-btn">Close in SecOpsAI</button>
              <button class="mini-btn" id="selected-finding-copy-close-btn">Copy close command</button>
            </div>
            <div class="small" style="margin-top:10px;">Only guarded dispositions are available here. Use the CLI directly for any more sensitive disposition.</div>
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
          <div class="task-card-actions" style="margin-top:10px;"><button class="mini-btn" id="selected-finding-run-investigate-btn">Investigate now</button><button class="mini-btn" id="selected-finding-copy-investigate-btn">Copy investigate</button><button class="mini-btn" id="selected-finding-copy-research-btn">Copy research</button>${!latestSession ? `<button class="mini-btn" id="selected-finding-run-research-btn">Run source-backed research</button>` : ''}${nativeInsight?.pendingAction ? `<button class="mini-btn" id="selected-finding-run-apply-btn">Apply now</button><button class="mini-btn" id="selected-finding-copy-apply-btn">Copy apply-action</button>` : ''}<button class="mini-btn" id="selected-finding-task-btn">Create investigation task</button>${related[0]?.item ? `<button class="mini-btn" id="selected-finding-prompt-btn">Open lead brief</button>` : ''}</div>
        </div>
      </div>
    `;
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
          <td><strong>${escapeHtml(action.action_type || 'unknown')}</strong><div class="small">${escapeHtml(action.action_id || '—')}</div></td>
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
              <div class="small">${escapeHtml(artifact.kind || 'artifact')} • ${escapeHtml(fmtDate(artifact.created_at))}</div>
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

function renderIntegrations() {
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
      <div class="card"><div class="metric">${triageSummary ? triageSummary.open_findings ?? 0 : '—'}</div><div class="metric-label">Open findings</div></div>
      <div class="card"><div class="metric">${triageSummary ? triageSummary.in_review_findings ?? 0 : '—'}</div><div class="metric-label">In review</div></div>
      <div class="card"><div class="metric">${triageSummary ? triageSummary.pending_actions ?? pendingActions.length : '—'}</div><div class="metric-label">Pending actions</div></div>
      <div class="card"><div class="metric">${triageSummary ? triageSummary.applied_actions ?? localAppliedActionsCount() : '—'}</div><div class="metric-label">Applied actions</div></div>
      <div class="card"><div class="metric">${openSessions}</div><div class="metric-label">Open sessions</div></div>
      <div class="card"><div class="metric">${pendingApprovals}</div><div class="metric-label">Pending approvals</div></div>
      <div class="card"><div class="metric">${localFindingsArtifact()?.total_findings ?? '—'}</div><div class="metric-label">Latest findings artifact total</div></div>
      <div class="card"><div class="metric">${recentRuns.length}</div><div class="metric-label">Recent orchestrator runs</div></div>
      <div class="card"><div class="metric">${escapeHtml(currentAiGuard.hostedEnabled ? 'Guarded enabled' : 'Local-first only')}</div><div class="metric-label">Hosted AI guardrail mode</div></div>`;
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
        <div class="small" style="margin-top:12px;">Copy native CLI commands from this dashboard for investigation and action application without deleting or mutating findings from the UI.</div>
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
  return sortLatestFirst(
    blogOpsDrafts().filter(draft => filter === 'all' || String(draft.review_status || '') === filter),
    BLOG_DRAFT_LATEST_FIELDS
  );
}

function renderReadinessPill(draft = {}) {
  const missing = typeof draft.readiness_status === 'undefined' || draft.readiness_status === null || draft.readiness_status === '';
  const status = missing ? 'not scored' : statusLabel(draft.readiness_status);
  const score = Number(draft.readiness_score || 0);
  const statusClass = String(draft.readiness_status || 'not-scored').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const label = missing ? status : `${status} · ${score}`;
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
  if (!items.length) return `<p class="small">${escapeHtml(empty)}</p>`;
  return `<ul class="blog-blocker-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
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
      return;
    }
    renderBlogOps();
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
    ['Drafts', counts.drafts ?? blogOpsDrafts().length, 'review records in repo'],
    ['Needs review', counts.needs_review ?? 0, 'external news waits here'],
    ['Approved', counts.approved ?? 0, `${counts.approved_publishable ?? counts.approved ?? 0} publishable${Number(counts.approved_blocked || 0) ? `, ${counts.approved_blocked} blocked` : ''}`],
    ['Deployed', counts.deployed ?? 0, 'deployed to Cloudflare'],
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
      <div class="kv-row"><span class="kv-key">Trust</span><span class="kv-val">${escapeHtml(sourceMetadata.source_trust_level || 'unknown')}</span></div>
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
    actionability: el('triage-ops-filter-actionability')?.value || 'actionable',
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
  setButtonBusy(button, true, 'Refreshing…');
  setStatus('<span class="dot"></span> Running read-only daily dashboard refresh…');
  try {
    await boot();
    setStatus('<span class="dot"></span> Daily dashboard refresh completed');
  } catch (error) {
    setStatus(`Daily dashboard refresh failed: ${error.message || error}`, true);
  } finally {
    setButtonBusy(button, false);
  }
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
      ${blockers.length ? `<div class="evidence-notice warning"><strong>Blocked:</strong> ${escapeHtml(blockers.join('; '))}</div>` : ''}
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
  const actionable = alerts.filter(item => item.actionability?.bucket === 'actionable');
  const cards = [
    ['SCM alerts', alerts.length, 'active supply-chain findings'],
    ['Actionable', actionable.length, 'needs operator work'],
    ['Open', alerts.filter(item => String(item.status || '').toLowerCase() === 'open').length, 'waiting for triage'],
    ['Actionable critical', actionable.filter(item => String(item.severity || '').toLowerCase() === 'critical').length, 'true-priority queue'],
    ['No local impact', alerts.filter(item => item.actionability?.bucket === 'no_local_impact').length, 'hidden by default'],
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
    const hiddenNoImpact = (state.triageOps.alerts || []).filter(item => item.actionability?.bucket === 'no_local_impact').length;
    state.triageOps.selectedId = null;
    host.innerHTML = `<div class="empty-state">No actionable SCM alerts match this filter.${hiddenNoImpact ? ` ${escapeHtml(String(hiddenNoImpact))} no-local-impact review record(s) are hidden; switch Actionability to All alerts to audit them.` : ' Refresh evidence or adjust filters.'}</div>`;
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
  const isActionableAlert = actionability.bucket === 'actionable';
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
    ${!isActionableAlert ? `<div class="triage-actionability-callout">This finding is preserved as scanner evidence, but it is not currently an actionable incident: ${escapeHtml(actionability.reason || 'No local impact or advisory evidence is present.')} Close it as ${escapeHtml(statusLabel(rec.recommended_disposition || 'not_applicable'))} unless new evidence appears.</div>` : ''}
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
        <div class="kv-row"><span class="kv-key">Local usage</span><span class="kv-val">${alert.local_usage?.present ? `${alert.local_usage.match_count || 0} match(es)` : 'none found'}</span></div>
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
        <button class="primary-btn triage-ops-action-btn" data-triage-action="create-blog-draft" data-write="true" ${blogDraftDisabled ? 'disabled title="Blog drafts are disabled for no-local-impact or review-only scanner records."' : ''}>Create blog draft</button>
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
  renderTriageOps();
  renderResearchCases();
  renderBlogOps();
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

function renderEdgeWorkspace() {
  const workspace = state.edgeWorkspace.data;
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
  if (assetHost) assetHost.innerHTML = assets.length ? `<div class="table-wrap"><table><thead><tr><th>IP address</th><th>Hostname</th><th>Vendor / type</th><th>Status</th><th>Last seen</th></tr></thead><tbody>${assets.map(asset => `<tr><td><code>${escapeHtml(asset.ip_address || asset.label || 'unknown')}</code></td><td>${escapeHtml(asset.hostname || 'Unknown')}</td><td>${escapeHtml(asset.vendor || 'Unknown')}<div class="small">${escapeHtml(asset.device_type || '')}</div></td><td>${renderStatusPill(asset.status || 'unknown')}</td><td>${escapeHtml(fmtDate(asset.last_seen))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No Edge assets are present in the Core graph yet.</div>';

  const findingHost = el('edge-findings');
  if (findingHost) findingHost.innerHTML = findings.length ? `<div class="table-wrap"><table><thead><tr><th>Finding</th><th>Severity</th><th>Status</th><th>Last seen</th></tr></thead><tbody>${findings.slice(0, 100).map(finding => `<tr><td><strong>${escapeHtml(finding.title || finding.rule_name || finding.finding_id)}</strong><div class="small"><code>${escapeHtml(finding.finding_id || '')}</code> · ${escapeHtml(finding.summary || '')}</div></td><td>${renderSeverityPill(finding.severity)}</td><td>${renderStatusPill(finding.status || 'open')}</td><td>${escapeHtml(fmtDate(finding.last_seen || finding.created_at))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No Edge-origin findings are present in Core triage.</div>';

  const changeHost = el('edge-changes');
  if (changeHost) {
    const rows = [...(Array.isArray(changes.nodes) ? changes.nodes : []).map(item => ({ kind: 'Node', label: item.label || item.node_id || item.id, at: item.updated_at || item.last_seen || item.created_at })), ...(Array.isArray(changes.edges) ? changes.edges : []).map(item => ({ kind: 'Relationship', label: item.type || item.edge_type || item.id, at: item.updated_at || item.observed_at || item.created_at }))];
    changeHost.innerHTML = rows.length ? `<div class="feed">${rows.slice(0, 30).map(item => `<div class="feed-item"><strong>${escapeHtml(item.kind)}</strong><div>${escapeHtml(item.label || 'Graph change')}</div><div class="meta">${escapeHtml(fmtDate(item.at))}</div></div>`).join('')}</div>` : '<div class="empty">No recent graph changes were returned.</div>';
  }
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
    const retained = preserveSelection && state.researchCases.cases.some(item => item.case_id === state.researchCases.selectedId);
    state.researchCases.selectedId = retained ? state.researchCases.selectedId : (state.researchCases.cases[0]?.case_id || null);
    if (state.researchCases.selectedId) await loadResearchCaseDetail(state.researchCases.selectedId, { render: false });
    else state.researchCases.selected = null;
  } catch (error) {
    state.researchCases.error = error?.message || String(error);
    state.researchCases.cases = [];
    state.researchCases.selected = null;
  } finally {
    state.researchCases.loading = false;
    if (render) renderResearchCases();
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
    const [capabilities, watchlists, monitors, candidates, alerts] = await Promise.all([
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=capabilities`, { cache: 'no-store' }).then(response => response.json()),
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=watchlists`, { cache: 'no-store' }).then(response => response.json()),
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=monitors`, { cache: 'no-store' }).then(response => response.json()),
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=candidates`, { cache: 'no-store' }).then(response => response.json()),
      dashboardApiFetch(`${researchDiscoveryEndpoint()}?view=alerts`, { cache: 'no-store' }).then(response => response.json())
    ]);
    if (capabilities.ok === false || watchlists.ok === false || monitors.ok === false || candidates.ok === false || alerts.ok === false) throw new Error(capabilities.error || watchlists.error || monitors.error || candidates.error || alerts.error || 'Research discovery unavailable');
    discovery.capabilities = capabilities.result || null;
    discovery.watchlists = watchlists.result?.watchlists || [];
    discovery.monitors = monitors.result?.monitors || [];
    discovery.candidates = candidates.result?.candidates || [];
    discovery.alerts = alerts.result?.alerts || [];
  } catch (error) {
    discovery.error = error?.message || String(error);
  } finally {
    discovery.loading = false;
    if (render) renderResearchCases();
  }
}

async function runResearchDiscoveryAction(action, payload = {}, button = null) {
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
    renderResearchCases();
    setStatus(`<span class="dot"></span> Research discovery ${escapeHtml(action)} completed`);
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
  const watchlistSelect = el('research-discovery-watchlist-id');
  if (watchlistSelect) {
    const current = watchlistSelect.value;
    const selectedEcosystem = el('research-discovery-ecosystem')?.value || '';
    const options = discovery.watchlists.filter(item => !selectedEcosystem || item.ecosystem === selectedEcosystem);
    watchlistSelect.innerHTML = options.length
      ? options.map(item => `<option value="${escapeHtml(item.watchlist_id)}">${escapeHtml(item.ecosystem)} · ${escapeHtml(item.identifier)}</option>`).join('')
      : '<option value="">Add a watchlist first</option>';
    if (options.some(item => item.watchlist_id === current)) watchlistSelect.value = current;
  }
  const candidates = discovery.candidates || [];
  const candidateMarkup = candidates.length
    ? `<div class="table-wrap"><table><thead><tr><th>Candidate</th><th>Ecosystem</th><th>Score</th><th>Why</th><th>Status</th></tr></thead><tbody>${candidates.slice(0, 25).map(item => `<tr><td><strong>${escapeHtml(item.package)}</strong><div class="small">${escapeHtml(item.version)} vs ${escapeHtml(item.reference_identifier)}</div></td><td>${escapeHtml(item.ecosystem)}</td><td>${escapeHtml(String(item.score))}</td><td>${escapeHtml(item.reason || 'Similarity requires analyst review')}</td><td>${escapeHtml(statusLabel(item.status))}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state compact">No candidates yet. Add a watchlist, run a monitor, and review the resulting scoped candidates.</div>';
  const alertMarkup = discovery.alerts.length ? `<h4>Research alerts</h4><div class="table-wrap"><table><thead><tr><th>Alert</th><th>Severity</th><th>Reason</th><th>Delivery</th></tr></thead><tbody>${discovery.alerts.slice(0, 15).map(item => `<tr><td><code>${escapeHtml(item.alert_id)}</code></td><td>${escapeHtml(statusLabel(item.severity))}</td><td>${escapeHtml(item.reason || 'Review candidate')}</td><td><button class="mini-btn research-alert-deliver-btn" data-alert-id="${escapeHtml(item.alert_id)}" type="button">Email alert</button></td></tr>`).join('')}</tbody></table></div>` : '';
  candidatesHost.innerHTML = candidateMarkup + alertMarkup;
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
  const gaps = collectors.reduce((sum, item) => sum + (Number(item.coverage_gaps) || 0), 0);
  const paused = collectors.filter(item => !item.enabled).length;
  const risks = collectors.filter(item => item.retention?.retention_risk).length;
  statsHost.innerHTML = [
    edgeMetric('Collectors', collectors.length, paused ? `${paused} paused` : 'Defined global feeds'),
    edgeMetric('Events stored', totalEvents, 'Append-only ledger'),
    edgeMetric('Dead letters', deadLetters, deadLetters ? 'Awaiting retry' : 'Queue clear'),
    edgeMetric('Coverage gaps', gaps, gaps ? 'Replay required' : 'No missing windows'),
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
          Lag ${escapeHtml(formatCoverageLag(collector.lag_seconds))} · ${Number(collector.events_stored) || 0} events · ${Number(collector.pending_dead_letters) || 0} dead letters · ${Number(collector.coverage_gaps) || 0} gaps${retention ? ` · cursor age ${escapeHtml(formatCoverageLag(retention.cursor_age_seconds))} of ${escapeHtml(formatCoverageLag(retention.retention_seconds))}` : ''}${snapshot ? ` · snapshot <code>${escapeHtml(snapshot.serial)}</code> (${Number(snapshot.item_count) || 0} items)` : ''}
        </div>
        <div class="small">Last run: ${escapeHtml(lastRun.status || 'never')}${lastRun.error_message ? ` · ${escapeHtml(lastRun.error_message)}` : ''}</div>
        <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
          <button class="mini-btn coverage-run-btn" data-ecosystem="${escapeHtml(collector.ecosystem)}" type="button" ${collector.enabled ? '' : 'disabled'}>Run now</button>
          <button class="mini-btn coverage-toggle-btn" data-ecosystem="${escapeHtml(collector.ecosystem)}" data-enabled="${collector.enabled ? '1' : '0'}" type="button">${collector.enabled ? 'Pause' : 'Resume'}</button>
        </div>
      </div>`;
  }).join('') : '<div class="empty-state compact">No collectors defined yet.</div>';

  eventsHost.innerHTML = coverage.events.length
    ? `<div class="table-wrap"><table><thead><tr><th>Registry time</th><th>Ecosystem</th><th>Package</th><th>Version</th><th>Event</th><th>State</th></tr></thead><tbody>${coverage.events.map(event => `<tr><td>${escapeHtml(event.registry_timestamp || '')}</td><td>${escapeHtml(event.ecosystem)}</td><td><strong>${escapeHtml(event.package)}</strong></td><td>${escapeHtml(event.version || '—')}</td><td>${escapeHtml(event.event_type)}</td><td>${escapeHtml(statusLabel(event.processing_state))}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state compact">No feed events recorded yet. Run a collector to start the ledger.</div>';

  windowsHost.innerHTML = coverage.windows.length
    ? `<div class="table-wrap"><table><thead><tr><th>Window start</th><th>Window end</th><th>Pages</th><th>Events</th><th>State</th></tr></thead><tbody>${coverage.windows.map(window => `<tr><td>${escapeHtml(window.window_start || '')}</td><td>${escapeHtml(window.window_end || '')}</td><td>${Number(window.processed_pages) || 0}/${Number(window.expected_pages) || 0}</td><td>${Number(window.events_stored) || 0}</td><td>${escapeHtml(window.state)}${window.gap_reason ? ` · ${escapeHtml(window.gap_reason)}` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state compact">No coverage windows recorded yet.</div>';
}

async function runResearchCaseAction(action, payload = {}, button = null) {
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
    renderResearchCases();
    setStatus(`<span class="dot"></span> ${escapeHtml(statusLabel(action))} completed for ${escapeHtml(nextId || 'research case')}`);
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

function bindResearchCaseDetailActions(researchCase) {
  el('research-save-case-btn')?.addEventListener('click', event => runResearchCaseAction('update', {
    case_id: researchCase.case_id,
    status: el('research-detail-status')?.value,
    disclosure_status: el('research-detail-disclosure')?.value,
    confidence: el('research-detail-confidence')?.value,
    severity: el('research-detail-severity')?.value,
    owner: el('research-detail-owner')?.value,
    summary: el('research-detail-summary')?.value,
    actor: 'dashboard-operator'
  }, event.currentTarget));
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
    runResearchCaseAction('publication-approve', { case_id: researchCase.case_id, review_id: review.review_id, waivers: [], actor: 'dashboard-publisher' }, event.currentTarget);
  });
  el('research-disclosure-btn')?.addEventListener('click', event => runResearchCaseAction('prepare-disclosure', {
    case_id: researchCase.case_id,
    recipient: el('research-disclosure-recipient')?.value,
    subject: el('research-disclosure-subject')?.value,
    body: el('research-disclosure-body')?.value,
    actor: 'dashboard-operator'
  }, event.currentTarget));
  el('research-sandbox-btn')?.addEventListener('click', event => runResearchCaseAction('sandbox-request', {
    case_id: researchCase.case_id,
    artifact_sha256: el('research-sandbox-sha256')?.value,
    justification: el('research-sandbox-justification')?.value,
    behaviors: ['network behavior', 'filesystem behavior', 'process behavior'],
    provider: 'manual-result-import',
    actor: 'dashboard-operator'
  }, event.currentTarget));
  document.querySelectorAll('#research-case-detail .research-intake-attach-btn').forEach(button => button.addEventListener('click', event => runResearchCaseAction('intake-attach', { case_id: researchCase.case_id, job_id: button.dataset.jobId, actor: 'dashboard-operator' }, event.currentTarget)));
  document.querySelectorAll('#research-case-detail .research-job-retry-btn').forEach(button => button.addEventListener('click', event => runResearchCaseAction('job-retry', { case_id: researchCase.case_id, job_id: button.dataset.jobId, actor: 'dashboard-operator' }, event.currentTarget)));
  document.querySelectorAll('#research-case-detail .research-job-cancel-btn').forEach(button => button.addEventListener('click', async event => {
    if (!(await requestConfirmation('Cancel this research job?', {
      title: 'Cancel research job',
      context: 'The cancellation will be recorded and the job will not continue.',
      confirmLabel: 'Cancel job',
      danger: true
    }))) return;
    runResearchCaseAction('job-cancel', { case_id: researchCase.case_id, job_id: button.dataset.jobId, actor: 'dashboard-operator' }, event.currentTarget);
  }));
  document.querySelectorAll('#research-case-detail .research-disclosure-status-btn').forEach(button => button.addEventListener('click', async event => {
    const status = button.dataset.disclosureStatus;
    if (status === 'sent' && !(await requestConfirmation('Record that this disclosure was sent externally?', {
      title: 'Record external disclosure',
      context: 'Only continue after the message has been reviewed and sent through the approved channel.',
      confirmLabel: 'Record as sent'
    }))) return;
    runResearchCaseAction('disclosure-status', { case_id: researchCase.case_id, disclosure_id: button.dataset.disclosureId, status, actor: 'dashboard-operator' }, event.currentTarget);
  }));
  document.querySelectorAll('#research-case-detail .research-sandbox-status-btn').forEach(button => button.addEventListener('click', async event => {
    if (!(await requestConfirmation('Approve this sandbox request? Execution remains unavailable until an isolated provider is configured.', {
      title: 'Approve sandbox request',
      context: 'Approval authorizes the request record only. Execution remains blocked until an isolated provider is configured.',
      confirmLabel: 'Approve request'
    }))) return;
    const action = button.dataset.sandboxAction || 'sandbox-status';
    runResearchCaseAction(action, { case_id: researchCase.case_id, request_id: button.dataset.requestId, status: button.dataset.sandboxStatus, public_submission_acknowledged: true, actor: 'dashboard-operator' }, event.currentTarget);
  }));
  document.querySelectorAll('#research-case-detail .research-retract-btn').forEach(button => button.addEventListener('click', () => {
    openResearchRetractModal(researchCase, button.dataset.itemType, button.dataset.itemId);
  }));
}

function renderResearchAutomationPanel(researchCase) {
  const subjects = researchCase.subjects || [];
  const packageSubject = subjects.find(item => item.subject_type === 'package' && item.status === 'active') || subjects[0] || {};
  const artifact = (researchCase.evidence || []).find(item => item.evidence_type === 'package_artifact' && item.status === 'active');
  const jobs = (researchCase.jobs || []).slice(0, 12);
  const reviews = researchCase.publication_reviews || [];
  const disclosures = researchCase.disclosures || [];
  const sandboxes = researchCase.sandbox_requests || [];
  const ecosystems = ['npm', 'pypi', 'nuget', 'maven', 'rubygems', 'packagist', 'go', 'open-vsx'];
  return researchDetailSection('Research automation', `
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
      <button class="secondary-btn" id="research-matrix-btn" type="button">Generate Evidence Matrix</button>
      <button class="secondary-btn" id="research-brief-btn" type="button">Generate Analyst Brief</button>
      <button class="secondary-btn" id="research-publication-check-btn" type="button">Run Publication Safety Check</button>
    </div>
    <details class="research-action-drawer"><summary>Compare packages</summary><p class="small">Both exact targets are fetched from allowlisted registries, hashed, and inspected statically. Package code is never installed or executed.</p><div class="research-form-grid"><label><span>Left ecosystem</span><select id="research-compare-left-ecosystem">${ecosystems.map(value => researchOption(value, packageSubject.ecosystem || 'npm')).join('')}</select></label><label><span>Left package</span><input id="research-compare-left-package" value="${escapeHtml(packageSubject.name || '')}" placeholder="legitimate package" /></label><label><span>Left version</span><input id="research-compare-left-version" value="${escapeHtml(packageSubject.version || '')}" placeholder="latest if empty" /></label><label><span>Right ecosystem</span><select id="research-compare-right-ecosystem">${ecosystems.map(value => researchOption(value, packageSubject.ecosystem || 'npm')).join('')}</select></label><label><span>Right package</span><input id="research-compare-right-package" placeholder="candidate package" /></label><label><span>Right version</span><input id="research-compare-right-version" placeholder="latest if empty" /></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-compare-packages-btn" type="button">Compare exact packages</button></div></details>
    <div class="research-form-grid">
      <label><span>Analyst verdict</span><select id="research-verdict-value"><option value="inconclusive">Inconclusive</option><option value="credible">Credible</option><option value="likely">Likely</option><option value="not_substantiated">Not substantiated</option><option value="benign">Benign</option><option value="retracted">Retracted</option></select></label>
      <label><span>Confidence</span><input id="research-verdict-confidence" type="number" min="0" max="100" value="50" /></label>
      <label class="research-span-2"><span>Rationale</span><textarea id="research-verdict-rationale" rows="2" placeholder="Explain the evidence and limitations."></textarea></label>
      <label class="research-span-2"><span>Evidence IDs</span><input id="research-verdict-evidence" placeholder="EVD-..., EVD-..." /></label>
    </div>
    <div class="research-form-actions"><button class="secondary-btn" id="research-verdict-btn" type="button">Record Human Verdict</button><button class="secondary-btn" id="research-publication-approve-btn" type="button" ${reviews[0]?.status === 'needs_approval' ? '' : 'disabled'}>Approve Publication Review</button></div>
    <details class="research-action-drawer"><summary>Prepare responsible disclosure</summary><div class="research-form-grid"><label><span>Recipient</span><input id="research-disclosure-recipient" placeholder="maintainer or registry contact" /></label><label><span>Subject</span><input id="research-disclosure-subject" /></label><label class="research-span-2"><span>Body</span><textarea id="research-disclosure-body" rows="4" placeholder="Leave empty for the safe template."></textarea></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-disclosure-btn" type="button">Prepare Disclosure</button></div></details>
    <details class="research-action-drawer"><summary>Request dynamic sandbox analysis</summary><p class="small">This creates an approval record only. Execution is unavailable until a dedicated isolated provider is configured.</p><div class="research-form-grid"><label class="research-span-2"><span>Artifact SHA-256</span><input id="research-sandbox-sha256" value="${escapeHtml(artifact?.sha256 || '')}" /></label><label class="research-span-2"><span>Justification</span><textarea id="research-sandbox-justification" rows="2"></textarea></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-sandbox-btn" type="button">Request Sandbox Approval</button></div></details>
    <div class="research-automation-status">
      <strong>Jobs and approvals</strong>
      ${jobs.length ? jobs.map(job => `<div class="feed-item"><code>${escapeHtml(job.job_id)}</code> · ${escapeHtml(statusLabel(job.status))} · ${escapeHtml(job.action)}${job.status === 'awaiting_review' ? ` <button class="mini-btn research-intake-attach-btn" data-job-id="${escapeHtml(job.job_id)}" type="button">Attach Verified Evidence</button>` : ''}${['failed','expired','canceled'].includes(job.status) ? ` <button class="mini-btn research-job-retry-btn" data-job-id="${escapeHtml(job.job_id)}" type="button">Retry</button>` : ''}${['queued','running','awaiting_review'].includes(job.status) ? ` <button class="mini-btn research-job-cancel-btn" data-job-id="${escapeHtml(job.job_id)}" type="button">Cancel</button>` : ''}</div>`).join('') : '<div class="small">No automated research jobs yet.</div>'}
      ${reviews.length ? `<div class="small">Latest publication review: <strong>${escapeHtml(statusLabel(reviews[0].status))}</strong>${(reviews[0].blockers || []).length ? ` · ${(reviews[0].blockers || []).length} blocker(s)` : ''}</div>` : ''}
      ${disclosures.length ? disclosures.slice(0, 3).map(item => `<div class="feed-item"><code>${escapeHtml(item.disclosure_id)}</code> · ${escapeHtml(statusLabel(item.status))} · ${escapeHtml(item.recipient)} <button class="mini-btn research-disclosure-status-btn" data-disclosure-id="${escapeHtml(item.disclosure_id)}" data-disclosure-status="approved" type="button">Approve</button><button class="mini-btn research-disclosure-status-btn" data-disclosure-id="${escapeHtml(item.disclosure_id)}" data-disclosure-status="sent" type="button">Record Sent</button></div>`).join('') : ''}
      ${sandboxes.length ? sandboxes.slice(0, 3).map(item => `<div class="feed-item"><code>${escapeHtml(item.request_id)}</code> · ${escapeHtml(statusLabel(item.status))} · provider ${escapeHtml(item.provider)}${item.status === 'pending_approval' ? ` <button class="mini-btn research-sandbox-status-btn" data-request-id="${escapeHtml(item.request_id)}" data-sandbox-action="sandbox-approve" data-sandbox-status="approved" type="button">Approve public submission</button>` : ''}</div>`).join('') : ''}
    </div>
  `);
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
  const readiness = researchCase.publication_readiness || { ready: false, blockers: [], warnings: [] };
  const subjects = researchCase.subjects || [];
  const evidence = researchCase.evidence || [];
  const iocs = researchCase.iocs || [];
  const rules = researchCase.rules || [];
  const findings = researchCase.findings || [];
  const timeline = researchCase.timeline || [];
  host.innerHTML = `
    <div class="research-detail-head">
      <div><div class="detail-eyebrow"><code>${escapeHtml(researchCase.case_id)}</code></div><h3>${escapeHtml(researchCase.title)}</h3><p class="small">Updated ${escapeHtml(fmtDate(researchCase.updated_at))} · ${escapeHtml(statusLabel(researchCase.case_type))}</p></div>
      <div class="research-detail-badges">${renderSeverityPill(researchCase.severity)}${renderStatusPill(researchCase.status)}</div>
    </div>
    <div class="research-readiness ${readiness.ready ? 'ready' : 'blocked'}">
      <strong>${readiness.ready ? 'Publication ready' : `${(readiness.blockers || []).length} publication blocker(s)`}</strong>
      ${renderBulletList(readiness.ready ? (readiness.warnings || []) : (readiness.blockers || []), readiness.ready ? 'No readiness warnings.' : 'Run the readiness workflow before publication.')}
    </div>
    ${renderResearchAutomationPanel(researchCase)}
    ${researchDetailSection('Case workflow', `
      <div class="research-form-grid">
        <label><span>Status</span><select id="research-detail-status">${['draft','investigating','validation','disclosure_pending','ready_to_publish','published','closed'].map(value => researchOption(value, researchCase.status)).join('')}</select></label>
        <label><span>Disclosure</span><select id="research-detail-disclosure">${['not_started','not_required','preparing','reported','coordinating','disclosed','closed'].map(value => researchOption(value, researchCase.disclosure_status)).join('')}</select></label>
        <label><span>Severity</span><select id="research-detail-severity">${['critical','high','medium','low','info'].map(value => researchOption(value, researchCase.severity)).join('')}</select></label>
        <label><span>Confidence</span><input id="research-detail-confidence" type="number" min="0" max="100" value="${escapeHtml(String(researchCase.confidence || 0))}" /></label>
        <label class="research-span-2"><span>Owner</span><input id="research-detail-owner" value="${escapeHtml(researchCase.owner || '')}" maxlength="160" /></label>
        <label class="research-span-2"><span>Executive summary</span><textarea id="research-detail-summary" rows="5" maxlength="8000">${escapeHtml(researchCase.summary || '')}</textarea></label>
      </div><div class="research-form-actions"><button class="primary-btn" id="research-save-case-btn" type="button">Save workflow</button><button class="secondary-btn" id="research-export-btn" type="button">Download case report</button><button class="secondary-btn" id="research-draft-blog-btn" type="button" ${readiness.ready ? '' : 'disabled'} title="${readiness.ready ? 'Creates a review-only Blog Ops draft.' : 'Resolve publication blockers first.'}">Create review draft</button></div>`)}
    ${researchDetailSection('Subjects', researchTable(['Type','Subject','Version','Publisher','State'], subjects.map(item => `<tr class="${item.status === 'retracted' ? 'research-row-retracted' : ''}"><td>${escapeHtml(statusLabel(item.subject_type))}</td><td><strong>${escapeHtml(item.ecosystem ? `${item.ecosystem}:${item.name}` : item.name)}</strong></td><td>${escapeHtml(item.version || '—')}</td><td>${escapeHtml(item.publisher || '—')}</td><td>${researchRetractControl('subject', item)}</td></tr>`), 'No affected subjects recorded.'))}
    ${researchDetailSection('Evidence', researchTable(['Evidence','Type','Provenance','Collected','State'], evidence.map(item => `<tr class="${item.status === 'retracted' ? 'research-row-retracted' : ''}"><td><strong>${escapeHtml(item.title)}</strong><div class="small">${escapeHtml(item.locator || item.sha256 || 'No locator')}</div></td><td>${escapeHtml(statusLabel(item.evidence_type))}</td><td>${escapeHtml(item.provenance || '—')}</td><td>${escapeHtml(fmtDate(item.collected_at))}</td><td>${researchRetractControl('evidence', item)}</td></tr>`), 'No evidence recorded.'))}
    ${researchDetailSection('Indicators', researchTable(['Type','Value','Confidence','Evidence','State'], iocs.map(item => `<tr class="${item.status === 'retracted' ? 'research-row-retracted' : ''}"><td>${escapeHtml(item.ioc_type)}</td><td><code>${escapeHtml(item.value)}</code></td><td>${escapeHtml(String(item.confidence))}</td><td><code>${escapeHtml(item.source_evidence_id || '—')}</code></td><td>${researchRetractControl('ioc', item)}</td></tr>`), 'No indicators recorded; explicitly state when none were found.'))}
    ${researchDetailSection('Detection rules', researchTable(['Type','Rule','Validation','Evidence','State'], rules.map(item => `<tr class="${item.status === 'retracted' ? 'research-row-retracted' : ''}"><td>${escapeHtml(String(item.rule_type || '').toUpperCase())}</td><td><strong>${escapeHtml(item.name)}</strong>${item.purpose ? `<div class="small">${escapeHtml(item.purpose)}</div>` : ''}<pre class="research-rule-preview"><code>${escapeHtml(compactText(item.content || '', 420))}</code></pre></td><td>${escapeHtml(statusLabel(item.validation_status || item.validation?.status || 'unknown'))}</td><td><code>${escapeHtml(item.source_evidence_id || '—')}</code></td><td>${researchRetractControl('rule', item)}</td></tr>`), 'No detection rules attached.'))}
    ${researchDetailSection('Linked findings', researchTable(['Finding','Relationship','Linked'], findings.map(item => `<tr><td><code>${escapeHtml(item.finding_id)}</code></td><td>${escapeHtml(statusLabel(item.relationship))}</td><td>${escapeHtml(fmtDate(item.created_at))}</td></tr>`), 'No SOC findings linked.'))}
    <details class="research-action-drawer"><summary>Add subject</summary><div class="research-form-grid"><label><span>Type</span><select id="research-subject-type">${['package','extension','repository','publisher','brand','infrastructure','other'].map(value => researchOption(value, 'package')).join('')}</select></label><label><span>Ecosystem</span><input id="research-subject-ecosystem" placeholder="npm, pypi, nuget" /></label><label class="research-span-2"><span>Name</span><input id="research-subject-name" placeholder="Package, brand, repository, or infrastructure" /></label><label><span>Version</span><input id="research-subject-version" /></label><label><span>Publisher</span><input id="research-subject-publisher" /></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-add-subject-btn" type="button">Add subject</button></div></details>
    <details class="research-action-drawer"><summary>Add evidence</summary><div class="research-form-grid"><label><span>Type</span><select id="research-evidence-type">${['source','registry_metadata','package_artifact','static_analysis','sandbox_analysis','screenshot','analyst_note','other'].map(value => researchOption(value, 'source')).join('')}</select></label><label><span>Title</span><input id="research-evidence-title" /></label><label class="research-span-2"><span>Locator</span><input id="research-evidence-locator" placeholder="Public URL or controlled local reference" /></label><label class="research-span-2"><span>SHA-256</span><input id="research-evidence-sha256" maxlength="64" /></label><label><span>Provenance</span><input id="research-evidence-provenance" /></label><label><span>Notes</span><textarea id="research-evidence-notes" rows="3"></textarea></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-add-evidence-btn" type="button">Add evidence</button></div></details>
    <details class="research-action-drawer"><summary>Add IOC</summary><div class="research-form-grid"><label><span>Type</span><select id="research-ioc-type">${['domain','url','ipv4','ipv6','sha256','sha1','md5','email','wallet','file_path','other'].map(value => researchOption(value, 'domain')).join('')}</select></label><label><span>Confidence</span><input id="research-ioc-confidence" type="number" min="0" max="100" value="50" /></label><label class="research-span-2"><span>Value</span><input id="research-ioc-value" /></label><label><span>Source evidence</span><select id="research-ioc-evidence"><option value="">Not linked</option>${evidence.map(item => `<option value="${escapeHtml(item.evidence_id)}">${escapeHtml(item.title)}</option>`).join('')}</select></label><label><span>Tags</span><input id="research-ioc-tags" placeholder="credential-theft, skimmer" /></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-add-ioc-btn" type="button">Add IOC</button></div></details>
    <details class="research-action-drawer"><summary>Add detection rule</summary><p class="small">Rules are stored as research artifacts and structurally checked. SecOpsAI never executes submitted rule content.</p><div class="research-form-grid"><label><span>Type</span><select id="research-rule-type">${['yara','sigma','semgrep'].map(value => researchOption(value, 'sigma')).join('')}</select></label><label><span>Name</span><input id="research-rule-name" maxlength="240" placeholder="suspicious-package-execution" /></label><label><span>Source evidence</span><select id="research-rule-evidence"><option value="">Not linked</option>${evidence.map(item => `<option value="${escapeHtml(item.evidence_id)}">${escapeHtml(item.title)}</option>`).join('')}</select></label><label class="research-span-2"><span>Purpose</span><input id="research-rule-purpose" maxlength="2000" placeholder="What defensive behavior does this rule detect?" /></label><label class="research-span-2"><span>Rule content</span><textarea id="research-rule-content" rows="12" maxlength="524288" spellcheck="false" placeholder="Paste a YARA, Sigma, or Semgrep rule"></textarea></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-add-rule-btn" type="button">Add detection rule</button></div></details>
    <details class="research-action-drawer"><summary>Link finding or add note</summary><div class="research-form-grid"><label><span>Finding ID</span><input id="research-link-finding-id" placeholder="SCM-... or EDGE-..." /></label><label><span>Relationship</span><select id="research-link-relationship">${['supports','related','derived_from','impacts'].map(value => researchOption(value, 'supports')).join('')}</select></label><label class="research-span-2"><span>Analyst note</span><textarea id="research-note-text" rows="3"></textarea></label></div><div class="research-form-actions"><button class="secondary-btn" id="research-link-finding-btn" type="button">Link finding</button><button class="secondary-btn" id="research-add-note-btn" type="button">Add note</button></div></details>
    ${researchDetailSection('Timeline', timeline.length ? `<div class="feed">${timeline.slice().reverse().slice(0, 50).map(item => `<div class="feed-item"><strong>${escapeHtml(statusLabel(item.event_type))}</strong><div>${escapeHtml(item.message)}</div><div class="meta">${escapeHtml(item.actor)} · ${escapeHtml(fmtDate(item.created_at))}</div></div>`).join('')}</div>` : '<div class="empty-state compact">No case activity recorded.</div>')}
    ${state.researchCases.lastAction?.error ? `<div class="error">${escapeHtml(state.researchCases.lastAction.error)}</div>` : ''}
  `;
  bindResearchCaseDetailActions(researchCase);
}

function renderResearchCases() {
  const tokenInput = el('research-cases-admin-token');
  if (tokenInput && tokenInput.value !== state.researchCases.adminToken) tokenInput.value = state.researchCases.adminToken;
  const cases = state.researchCases.cases || [];
  const ready = cases.filter(item => item.status === 'ready_to_publish').length;
  const active = cases.filter(item => !['published', 'closed'].includes(item.status)).length;
  const disclosure = cases.filter(item => ['disclosure_pending'].includes(item.status) || ['reported', 'coordinating'].includes(item.disclosure_status)).length;
  const evidence = cases.reduce((sum, item) => sum + Number(item.evidence_count || 0), 0);
  const rules = cases.reduce((sum, item) => sum + Number(item.rule_count || 0), 0);
  const stats = el('research-cases-stats');
  if (stats) stats.innerHTML = [
    edgeMetric('Active cases', active, `${cases.length} total`),
    edgeMetric('Ready to publish', ready, 'Disclosure checks passed'),
    edgeMetric('Coordinating', disclosure, 'Disclosure in progress'),
    edgeMetric('Evidence records', evidence, 'Structured provenance'),
    edgeMetric('IOC records', cases.reduce((sum, item) => sum + Number(item.ioc_count || 0), 0), 'Normalized indicators'),
    edgeMetric('Detection rules', rules, 'YARA, Sigma, Semgrep')
  ].join('');
  renderResearchWatchlist();
  renderResearchDiscovery();
  const list = el('research-case-list');
  const filtered = filteredResearchCases();
  if (list) list.innerHTML = state.researchCases.loading && !cases.length
    ? '<div class="empty-state">Loading research cases…</div>'
    : filtered.length
      ? `<div class="research-case-list">${filtered.map(item => `<button class="research-case-row ${item.case_id === state.researchCases.selectedId ? 'selected' : ''}" type="button" data-research-case-id="${escapeHtml(item.case_id)}"><span class="research-case-row-head"><strong>${escapeHtml(item.title)}</strong>${renderSeverityPill(item.severity)}</span><span class="small"><code>${escapeHtml(item.case_id)}</code> · ${escapeHtml(statusLabel(item.status))} · confidence ${escapeHtml(String(item.confidence || 0))}</span><span class="small">${escapeHtml(String(item.evidence_count || 0))} evidence · ${escapeHtml(String(item.ioc_count || 0))} IOCs · ${escapeHtml(fmtDate(item.updated_at))}</span></button>`).join('')}</div>`
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
        secopsai_edge_api: false
      },
      ai_guard: aiGuardConfig()
    };
  }
}

async function loadLocalTriageState() {
  try {
    const res = await dashboardApiFetch('/api/secopsai/triage-state');
    if (!res.ok) throw new Error(`Local triage HTTP ${res.status}`);
    state.localTriage = await res.json();
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

function startLiveExecutionRefreshLoop() {
  if (state.liveRefreshTimer) clearInterval(state.liveRefreshTimer);
  state.liveRefreshTimer = setInterval(() => {
    backgroundRefreshLiveExecutionState();
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
  document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => setPage(btn.dataset.page)));
  el('mobile-menu-btn')?.addEventListener('click', toggleMobileNav);
  el('work-table-view-btn')?.addEventListener('click', () => { workView = 'table'; renderTasks(); });
  el('work-board-view-btn')?.addEventListener('click', () => { workView = 'board'; renderTasks(); });
  el('top-search-btn')?.addEventListener('click', openCommandPalette);
  el('top-help-btn')?.addEventListener('click', () => openHelpDrawer(currentPageFromLocation()));
  el('top-health-btn')?.addEventListener('click', () => setPage('integrations'));
  el('workspace-switcher')?.addEventListener('click', () => showToast('This pilot uses one authenticated SecOpsAI workspace. Customer/site switching is available when multi-tenant workspaces are enabled.', 'info'));
  el('confirm-dialog-confirm')?.addEventListener('click', () => finishConfirmation(true));
  el('confirm-dialog-cancel')?.addEventListener('click', () => finishConfirmation(false));
  el('confirm-dialog-close')?.addEventListener('click', () => finishConfirmation(false));
  el('confirm-dialog')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) finishConfirmation(false);
  });
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
      closeHelpDrawer();
    }
  });
  el('refresh-btn')?.addEventListener('click', async () => {
    if (bootError) {
      setStatus(bootError, true);
      return;
    }
    const btn = el('refresh-btn');
    setButtonBusy(btn, true, '<span class="dot"></span> Refreshing…');
    setStatus('<span class="dot"></span> Refreshing dashboard data…');
    try {
      await boot();
    } finally {
      setButtonBusy(btn, false);
    }
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
  el('edge-refresh-btn')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    setButtonBusy(btn, true, '<span class="dot"></span> Refreshing…');
    await loadEdgeWorkspace();
    setButtonBusy(btn, false);
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
  el('prompt-mode-select')?.addEventListener('change', (event) => {
    promptModalState.mode = event?.target?.value || 'smart-local';
    refreshPromptBrief();
  });
  el('blog-edit-modal-close')?.addEventListener('click', closeBlogEditModal);
  el('blog-edit-cancel-btn')?.addEventListener('click', closeBlogEditModal);
  el('blog-edit-save-btn')?.addEventListener('click', (event) => saveBlogDraftEdit(event.currentTarget));
  ['task-search', 'task-filter-domain', 'task-filter-priority', 'task-filter-status', 'task-filter-owner', 'task-filter-reviewer'].forEach(id => {
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
    setButtonBusy(event.currentTarget, true, 'Refreshing…');
    await loadResearchCases();
    setButtonBusy(event.currentTarget, false);
  });
  el('research-watchlist-refresh-btn')?.addEventListener('click', async event => {
    setButtonBusy(event.currentTarget, true, 'Refreshing…');
    await loadResearchWatchlist();
    setButtonBusy(event.currentTarget, false);
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
    setButtonBusy(event.currentTarget, true, 'Refreshing…');
    await loadResearchDiscovery();
    setButtonBusy(event.currentTarget, false);
  });
  el('research-discovery-add-watchlist-btn')?.addEventListener('click', event => runResearchDiscoveryAction('watchlist-add', {
    ecosystem: el('research-discovery-ecosystem')?.value || 'npm',
    watch_type: el('research-discovery-watch-type')?.value || 'package',
    identifier: el('research-discovery-identifier')?.value || '',
    threshold: Number(el('research-discovery-threshold')?.value || 70),
    reason: 'Added from Research discovery console'
  }, event.currentTarget));
  el('research-discovery-create-monitor-btn')?.addEventListener('click', event => runResearchDiscoveryAction('monitor-create', {
    ecosystem: el('research-discovery-ecosystem')?.value || 'npm',
    watchlist_id: el('research-discovery-watchlist-id')?.value || '',
    interval_seconds: Number(el('research-discovery-interval')?.value || 3600),
    priority: 'normal'
  }, event.currentTarget));
  el('research-discovery-run-due-btn')?.addEventListener('click', event => runResearchDiscoveryAction('monitor-run-due', { limit: 25 }, event.currentTarget));
  el('research-discovery-correlate-btn')?.addEventListener('click', event => runResearchDiscoveryAction('campaign-correlate', {}, event.currentTarget));
  document.querySelectorAll('.research-alert-deliver-btn').forEach(button => button.addEventListener('click', event => runResearchDiscoveryAction('alert-deliver', { alert_id: button.dataset.alertId, channel: 'email' }, event.currentTarget)));
  el('coverage-refresh-btn')?.addEventListener('click', () => loadCoverage());
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
    const btn = el('blog-refresh-btn');
    setButtonBusy(btn, true, '<span class="dot"></span> Refreshing…');
    await loadBlogOpsStatus();
    setButtonBusy(btn, false);
  });
  el('blog-draft-filter')?.addEventListener('change', renderBlogOps);
  document.querySelectorAll('.blog-action-btn').forEach(btn => {
    btn.addEventListener('click', () => runBlogOpsAction(btn.dataset.blogAction, { button: btn }));
  });
}

window.addEventListener('popstate', () => setPage(currentPageFromLocation(), { skipHistory: true }));

window.addEventListener('DOMContentLoaded', () => {
  setPage(currentPageFromLocation(), { skipHistory: true });
  bindEvents();
  startTopStripClock();
  initializeDashboardAuth();
});

window.addEventListener('beforeunload', () => {
  stopDashboardRuntime();
  authSubscription?.unsubscribe();
});
