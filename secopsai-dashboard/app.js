window.__SECOPSAI_APP_LOADED = true;

const supabaseGlobal = window.supabase;
const cfg = window.SECOPSAI_CONFIG || {};
let supabaseClient = null;
let bootError = null;

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

const state = {
  runs: [],
  runRequests: [],
  findings: [],
  workItems: [],
  channelRoutes: [],
  events: [],
  integrationStatus: null,
  localTriage: null,
  selectedFindingId: null,
  selectedSessionId: null,
  selectedSessionDetail: null,
  nativeFindingOverrides: new Map(),
  outputEvidenceCache: new Map(),
  liveRefreshTimer: null,
  optionalTables: {
    findings: true,
    run_requests: true
  }
};

const taskModalState = { editingId: null, sourceFinding: null };
const promptModalState = { item: null, role: null, brief: null, mode: 'smart-local', runRequestId: null, relatedRunId: null, pollTimer: null, launchedFromTaskModal: false };
const dragState = { taskId: null };
const pages = ["mission-control", "tasks", "findings", "integrations"];
const PAGE_CONTEXT = {
  "mission-control": "Mission Control overview",
  "tasks": "Task queue, ownership, and run visibility",
  "findings": "Detection triage and correlation surface",
  "integrations": "Native triage and helper visibility"
};

function el(id) { return document.getElementById(id); }

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
}

async function postNativeHelper(path, payload) {
  const response = await fetch(path, {
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
  const response = await fetch(`/api/secopsai/session?session_id=${encodeURIComponent(normalized)}`);
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

function updateTopStrip(pageId) {
  const context = el('top-strip-context');
  if (context) context.textContent = PAGE_CONTEXT[pageId] || 'SecOpsAI dashboard';
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

function setPage(pageId) {
  pages.forEach((id) => {
    const page = el(`page-${id}`);
    if (page) page.classList.toggle("active", id === pageId);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === pageId);
  });
  updateTopStrip(pageId);
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
  return status.replaceAll('_', ' ');
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
  return `<span class="status-pill status-${safeClass}"><span class="dot"></span> ${escapeHtml(label || raw)}</span>`;
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
  return finding?.detected_at || finding?.first_seen_at || finding?.observed_at || finding?.created_at || null;
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
  const nextId = nextFindingId || findingId(state.findings?.[0]) || null;
  state.selectedFindingId = nextId;
}

function currentSelectedFinding() {
  if (!state.findings.length) return null;
  return state.findings.find(f => String(findingId(f)) === String(state.selectedFindingId)) || state.findings[0] || null;
}

async function bestEffortLinkFindingToTask(finding, task) {
  const normalizedId = findingId(finding);
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
    'This dashboard is control-plane only, but this task should be executed directly in the local workspace through the current OpenClaw dispatcher path; do not require ACP/Codex-specific execution assumptions.',
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
Context: this dashboard is control-plane only. This task should be executed directly in the local workspace via the active OpenClaw dispatcher path, without ACP-specific or Codex-specific assumptions.

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
Execute directly in the local workspace via the current OpenClaw dispatcher path. Do not assume ACP one-shot execution, Codex-specific runtime requirements, or any external planning backend. Use the brief below as grounded context, but improve repo/path inference if stronger evidence appears during code inspection.
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
- Do not refuse or stop solely because ACP/Codex-specific execution paths are unavailable; continue using the current OpenClaw/local-workspace execution path.
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

  if (!result.ok && !result.skipped) {
    // Non-fatal: the run request is already queued in Supabase. Treat Discord notify as best-effort.
    await createDashboardEvent('run_now_notify_failed', `Run notify failed: ${role}`, result.reason || 'Unknown notify failure', 'warning', { related_work_item_id: item?.id || null, related_run_id: run?.id || null });
    setStatus(`Run queued, but notify failed: ${escapeHtml(result.reason || 'unknown error')}`, true);
    setButtonBusy(runBtn, false);
    setTimeout(() => closePromptModal(), 1400);
    return;
  }

  setStatus(`<span class="dot"></span> Run request queued for ${escapeHtml(shortRoleLabel(role))} (notified #${notifyChannel})`);
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
  const openFindings = state.findings.filter(f => !['resolved', 'closed', 'done'].includes(String(findingStatus(f)).toLowerCase())).length;
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


function renderTasks() {
  const statuses = [["inbox", "Inbox"],["planned", "Planned"],["in_progress", "In Progress"],["review", "Review"],["blocked", "Blocked"],["done", "Done"]];
  const board = el("task-board");
  if (!board) return;
  board.innerHTML = "";
  const visibleItems = filteredWorkItems();

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
                alert(`Failed to assign suggested owner: ${err.message || err}`);
              });
            return;
          }
          if (action === 'assign-reviewer') {
            event.stopPropagation();
            Promise.resolve()
              .then(() => assignSuggestedReviewerForTask(item))
              .catch(err => {
                console.error('assign suggested reviewer failed', err);
                alert(`Failed to assign suggested reviewer: ${err.message || err}`);
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
  const findingsAvailable = state.optionalTables.findings !== false;
  if (findingsAvailable && state.findings.length && !state.selectedFindingId) selectFinding();
  const triageSummary = localTriageSummary();
  const triageLatest = localTriageLatestRun();
  const pendingActions = localPendingActions();
  const summary = el('finding-summary');
  const total = state.findings.length;
  const openCount = state.findings.filter(f => !['resolved', 'closed', 'done'].includes(String(findingStatus(f)).toLowerCase())).length;
  const criticalCount = state.findings.filter(f => ['critical', 'urgent'].includes(String(findingSeverity(f)).toLowerCase())).length;
  const linkedCount = state.findings.filter(f => relatedTasksForFinding(f).length > 0).length;
  const actionableCount = state.findings.filter(f => {
    const related = relatedTasksForFinding(f);
    return related.length === 0 || (related[0]?.item?.status && !['done', 'review'].includes(related[0].item.status));
  }).length;
  if (summary) {
    summary.innerHTML = `
      <div class="card"><div class="metric">${total}</div><div class="metric-label">Findings loaded</div></div>
      <div class="card"><div class="metric">${openCount}</div><div class="metric-label">Open / triageable</div></div>
      <div class="card"><div class="metric">${criticalCount}</div><div class="metric-label">Critical / urgent</div></div>
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
      table.innerHTML = `<div class="empty">The <code>findings</code> table is not available yet. You can still create investigation tasks from this view and wire the table later without changing the UI again.</div>`;
    } else if (!state.findings.length) {
      table.innerHTML = `<div class="empty">No findings yet. Once data lands in <code>findings</code>, this queue will show severity, confidence, correlation, and task actions.</div>`;
    } else {
      table.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>Finding</th><th>Severity</th><th>Status</th><th>Correlation</th><th>Linked work</th><th>Actions</th></tr></thead>
          <tbody>${state.findings.map(f => {
            const related = relatedTasksForFinding(f);
            const best = related[0] || null;
            const normalizedFindingId = findingId(f);
            const selected = String(state.selectedFindingId) === String(normalizedFindingId);
            return `<tr class="finding-row ${selected ? 'selected-row' : ''}" data-finding-id="${escapeHtml(normalizedFindingId || '')}">
              <td><strong>${escapeHtml(findingTitle(f))}</strong><div class="small">${escapeHtml(displayFindingSource(f))}${findingConfidence(f) !== null ? ` • confidence ${escapeHtml(findingConfidence(f))}` : ''}</div><div class="small">${escapeHtml(compactText(findingBody(f), 120))}</div></td>
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
        const finding = state.findings.find(f => String(findingId(f)) === String(btn.dataset.findingId));
        if (finding) openFindingTaskModal(finding);
      }));
      table.querySelectorAll('.finding-run-investigate-btn').forEach(btn => btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const finding = state.findings.find(f => String(findingId(f)) === String(btn.dataset.findingId));
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
        const finding = state.findings.find(f => String(findingId(f)) === String(btn.dataset.findingId));
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
            <div class="kv-row"><div class="kv-key">Suggested domain</div><div class="kv-val">${escapeHtml(findingDomainHint(selected))}</div></div>
          </div>
          <div class="detail-summary">${escapeHtml(findingBody(selected) || 'No additional finding narrative available.')}</div>
        </div>
        <div class="card finding-detail-card">
          <h4>Related tasks</h4>
          ${related.length ? related.map(match => `<div class="feed-item compact-feed-item"><div><strong>${escapeHtml(match.item.title)}</strong></div><div class="small">${escapeHtml(humanizeSnake(match.item.status || 'unknown'))} • score ${match.score}</div><div class="small">${escapeHtml(compactText(match.reasons.join(' • '), 140))}</div></div>`).join('') : '<div class="empty">No convincing task match yet. Create a dedicated investigation task.</div>'}
        </div>
      </div>
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
          <div class="kv-row"><div class="kv-key">Latest findings artifact</div><div class="kv-val">${escapeHtml(localFindingsArtifact()?.generated_at ? fmtDate(localFindingsArtifact().generated_at) : 'Unavailable')}</div></div>
          <div class="kv-row"><div class="kv-key">Latest orchestrator run</div><div class="kv-val">${escapeHtml(localTriageLatestRun()?.generated_at ? fmtDate(localTriageLatestRun().generated_at) : 'Unavailable')}</div></div>
          <div class="kv-row"><div class="kv-key">Runtime authority</div><div class="kv-val">SecOpsAI / OpenClaw</div></div>
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

function renderAll() {
  renderMissionControl();
  renderTasks();
  renderFindings();
  renderRunRequests();
  renderIntegrations();
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

  const pending = fetch(getRunOutputEndpointUrl(rel))
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

async function loadIntegrationStatus() {
  try {
    const res = await fetch(cfg.integrationStatusEndpoint || '/api/integration-status');
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
        secopsai_research_api: false
      },
      ai_guard: aiGuardConfig()
    };
  }
}

async function loadLocalTriageState() {
  try {
    const res = await fetch('/api/secopsai/triage-state');
    if (!res.ok) throw new Error(`Local triage HTTP ${res.status}`);
    state.localTriage = await res.json();
    await refreshSelectedSessionDetail();
  } catch (error) {
    console.warn('local triage load failed', error);
    state.localTriage = { ok: false, error: error?.message || String(error) };
    state.selectedSessionDetail = null;
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
    return alert('Task title is required.');
  }

  try {
    let item = null;
    if (taskModalState.editingId) {
      const { data, error } = await supabaseClient.from('work_items').update(payload).eq('id', taskModalState.editingId).select().single();
      if (error) return alert(`Failed to update task: ${error.message}`);
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
      if (error) return alert(`Failed to create task: ${error.message}`);
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
    alert('No task is selected for deletion. Close and reopen the task, then try again.');
    return;
  }
  if (!confirm(`Delete this task${item?.title ? `: ${item.title}` : ''}?`)) return;
  const { error } = await supabaseClient.from('work_items').delete().eq('id', taskId);
  if (error) return alert(`Failed to delete task: ${error.message}`);
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
  if (error) return alert(`Failed to move task: ${error.message}`);
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
  state.findings = await optionalLoadTable('findings', { orderBy: { column: 'created_at', ascending: false }, limit: 100 });

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

  renderAll();
  startLiveExecutionRefreshLoop();

  if (errors.length) {
    setStatus(`Dashboard loaded with partial data • ${escapeHtml(errors[0])}`, true);
  }
}

function bindEvents() {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => setPage(btn.dataset.page)));
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
        alert(`Delete failed: ${e?.message || e}`);
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
  ['task-search', 'task-filter-domain', 'task-filter-priority', 'task-filter-status', 'task-filter-owner', 'task-filter-reviewer'].forEach(id => {
    el(id)?.addEventListener('input', renderTasks);
    el(id)?.addEventListener('change', renderTasks);
  });
  ['task-filter-external', 'task-filter-security'].forEach(id => {
    el(id)?.addEventListener('change', renderTasks);
  });
}

window.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  startTopStripClock();
  setPage('mission-control');
  if (bootError) {
    setStatus(bootError, true);
    return;
  }
  boot();
});
