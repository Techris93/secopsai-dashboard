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
    'security/threat-detection-engineer',
    'product/product-manager',
    'product/ui-designer',
    'revenue/content-creator',
    'revenue/outbound-strategist',
    'revenue/sales-engineer',
    'support/support-responder'
  ];
})();

const ROLE_OPTIONS_HTML = (() => {
  const opts = ROLE_LABELS.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
  return `<option value="">Unassigned</option>${opts}`;
})();

const state = {
  runs: [],
  runRequests: [],
  findings: [],
  workItems: [],
  artifacts: [],
  channelRoutes: [],
  events: [],
  integrationStatus: null,
  lastDiscordTest: null,
  selectedFindingId: null,
  optionalTables: {
    findings: true,
    run_requests: true
  }
};

const taskModalState = { editingId: null, sourceFinding: null };
const artifactModalState = { editingId: null };
const promptModalState = { item: null, role: null, brief: null, mode: 'smart-local', runRequestId: null, relatedRunId: null, pollTimer: null, launchedFromTaskModal: false };
const dragState = { taskId: null };
const pages = ["mission-control", "org-map", "agents", "tasks", "findings", "artifacts", "integrations"];

function el(id) { return document.getElementById(id); }

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleString();
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

function setPage(pageId) {
  pages.forEach((id) => {
    const page = el(`page-${id}`);
    if (page) page.classList.toggle("active", id === pageId);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === pageId);
  });
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

function artifactRunOptions() {
  return state.runs.slice(0, 200).map(run => ({
    id: run.id,
    label: `${run.role_label} • ${run.task_summary}`
  }));
}

function artifactWorkItemOptions() {
  return state.workItems.slice().sort((a, b) => a.title.localeCompare(b.title)).map(item => ({
    id: item.id,
    label: item.title
  }));
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
  if (["customer", "copy", "launch", "website"].some(x => text.includes(x))) return 'revenue';
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
  return findingTaskMatches(finding).slice(0, 4);
}

function correlatedRunRequestsForFinding(finding) {
  const text = `${findingTitle(finding)} ${findingBody(finding)} ${findingSource(finding)}`.toLowerCase();
  const desiredDomain = findingDomainHint(finding);
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
    return { request: req, score, reasons: hits.slice(0, 3) };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 4);
}

function selectFinding(findingId = null) {
  const nextId = findingId || state.findings?.[0]?.id || null;
  state.selectedFindingId = nextId;
}

function currentSelectedFinding() {
  if (!state.findings.length) return null;
  return state.findings.find(f => String(f.id) === String(state.selectedFindingId)) || state.findings[0] || null;
}

async function bestEffortLinkFindingToTask(finding, task) {
  if (!finding?.id || !task?.id || state.optionalTables.findings === false) return false;
  const candidates = ['related_work_item_id', 'work_item_id', 'linked_work_item_id', 'task_id', 'linked_task_id'];
  for (const column of candidates) {
    try {
      const { error } = await supabaseClient.from('findings').update({ [column]: task.id }).eq('id', finding.id);
      if (!error) return true;
    } catch {}
  }
  return false;
}

function buildFindingTaskDraft(finding = null) {
  const related = finding ? relatedTasksForFinding(finding) : [];
  const correlatedRequests = finding ? correlatedRunRequestsForFinding(finding) : [];
  const title = finding ? `Investigate: ${findingTitle(finding)}` : 'Investigate finding';
  const desc = finding ? `${findingBody(finding) || 'Review finding context and determine next action.'}

Finding status: ${findingStatus(finding)}
Severity: ${findingSeverity(finding)}
Source: ${findingSource(finding)}${findingConfidence(finding) !== null ? `
Confidence: ${findingConfidence(finding)}` : ''}${findingFingerprint(finding) ? `
Fingerprint: ${findingFingerprint(finding)}` : ''}${findingDetectedAt(finding) ? `
Detected at: ${findingDetectedAt(finding)}` : ''}${related.length ? `

Existing related work:
${related.map(match => `- ${match.item.title} (score ${match.score})`).join('\n')}` : ''}${correlatedRequests.length ? `

Related run requests:
${correlatedRequests.map(match => `- ${match.request.role_label} (${match.request.status || 'queued'})`).join('\n')}` : ''}` : 'Review finding context and determine next action.';
  return {
    title,
    description: desc.trim(),
    domain: finding ? findingDomainHint(finding) : 'security',
    priority: String(findingSeverity(finding)).toLowerCase() === 'critical' ? 'urgent' : String(findingSeverity(finding)).toLowerCase() === 'high' ? 'high' : 'normal',
    status: 'inbox',
    owner_role: finding && findingDomainHint(finding) === 'platform' ? 'platform/backend-architect' : 'security/security-engineer',
    reviewer_role: 'product/product-manager',
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
    security: 'security/security-engineer',
    product: 'product/product-manager',
    revenue: 'revenue/content-creator',
    support: 'support/support-responder'
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
      when: /dispatcher|orchestrator|discord|telemetry|agent run|finding|detection|intel|pipeline|backend|api|worker/.test(haystack),
      paths: ['secopsai/discord_dispatcher.py', 'secopsai/orchestrator/', 'secopsai/backend/', 'secopsai/README.md'],
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

function inferWorkBriefPlan(item = {}, roleLabel = null) {
  const repo = inferTaskRepoContext(item, roleLabel);
  const role = repo.role;
  const title = item?.title || 'Untitled task';
  const description = (item?.description || '').trim();
  const dueDate = item?.due_date || null;

  const focus = [];
  if (description) focus.push(description);
  focus.push('Improve the implementation directly instead of producing generic advice.');
  focus.push('Preserve current working behavior unless changing it is required to complete the task.');
  if (repo.secondaryRepos.length) focus.push(`Handle cross-repo implications between ${repo.primaryRepo} and ${repo.secondaryRepos.join(', ')} explicitly.`);
  focus.push('Keep the solution practical, local-first, and shippable now.');

  const constraints = [
    'This dashboard is control-plane only; live conversations and dispatch belong to orchestrator flows.',
    'Prefer existing metadata and lightweight heuristics over a hard dependency on a new backend.',
    'Validate syntax/basic behavior before handing off.'
  ];
  if (item?.requires_security_review) constraints.push('Flag security-sensitive changes and leave reviewer-ready notes.');
  if (item?.external_facing) constraints.push('Assume output may be visible outside the operator team; keep UX copy clear.');

  const deliverables = [
    'What changed and why',
    'Files touched',
    'Any blockers or follow-ups',
    'How to use the result from the dashboard UI'
  ];

  const acceptanceChecks = [
    'The brief should mention the most likely repo and file paths instead of only a generic dashboard template.',
    'If the task appears cross-repo, explain what likely lives in each repo.',
    'If a future intelligent/agent-generated path exists, keep it additive rather than required for today.'
  ];
  if (dueDate) acceptanceChecks.push(`Keep urgency in mind: target due date is ${dueDate}.`);

  return { role, repo, title, description, focus, constraints, deliverables, acceptanceChecks };
}

function buildSmartLocalBrief(item, roleLabel = null) {
  const plan = inferWorkBriefPlan(item, roleLabel);
  return `Prepare work for ${plan.role}.

Mode: smart local brief
Context: this dashboard is control-plane only; the orchestrator owns live conversations and dispatch.

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
  return `SYSTEM / ORCHESTRATOR HANDOFF

You are preparing an implementation pass for ${plan.role}.
Use the local smart brief below as grounded context, but feel free to improve repo/path inference if stronger evidence appears during code inspection.
Do not require an external planning backend before doing useful work.

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

OBJECTIVE
${plan.focus.map(line => `- ${line}`).join('\n')}

OPERATING CONSTRAINTS
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
  btn.textContent = 'Run now';
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

  el('prompt-modal-title').textContent = 'Intelligent work brief';
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

  // The local helper endpoint intentionally supports ONLY ops-log / kanban-updates.
  // Direct dashboard-side dispatch to arbitrary channels is retired by design.
  const notifyChannel = 'ops-log';

  // Create an audit run row (queued) in agent_runs.
  const run = await createOrchestratorRun({
    taskSummary: `Run now requested for ${role}`,
    taskDetail: prompt,
    status: 'queued',
    outputSummary: route
      ? `Dashboard requested immediate execution. Suggested route: #${route.channel_name}.`
      : 'Dashboard requested immediate execution (no active route found).',
    relatedWorkItemId: item?.id || null,
    sourceChannelName: notifyChannel
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

  // Insert a run_requests queue item (picked up by discord_dispatcher.py).
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
    'run_now_requested',
    `Run now: ${role}`,
    route
      ? `Queued run request. Suggested route metadata: #${route.channel_name}.`
      : `Queued run request. No active route metadata found for this role.`,
    route ? 'info' : 'warning',
    { related_work_item_id: item?.id || null, related_run_id: run?.id || null }
  );

  // Best-effort notify: post to ops-log. A separate orchestrator/dispatcher should pick it up.
  const content = buildDiscordMessage('SecOpsAI run now (queued)', [
    `Role: ${role}`,
    run?.id ? `Run ID: ${run.id}` : null,
    route ? `Suggested route: #${route.channel_name}` : 'Suggested route: (none found)',
    '---',
    prompt
  ]);

  const result = await postDiscordUpdate(notifyChannel, content);

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
      const lifecycle = runRequestLifecycle(data, run);
      const artifacts = parseRunRequestArtifacts(data, run);
      const detailHtml = `
        <div class="rr-proof-list">
          <div><strong>Worker:</strong> ${escapeHtml(runRequestWorkerIdentity(data, run) || 'unknown')}</div>
          <div><strong>Run:</strong> ${escapeHtml(data?.related_run_id || run?.id || '—')}</div>
          <div><strong>Repo:</strong> ${escapeHtml(firstNonEmpty(data?.repo_path, run?.repo_path) || '—')}</div>
          <div><strong>Output:</strong> ${escapeHtml(firstNonEmpty(data?.output_path, run?.output_path) || '—')}</div>
          <div><strong>Commit:</strong> ${escapeHtml(artifacts.commit || '—')}</div>
          <div><strong>PR:</strong> ${escapeHtml(artifacts.prUrl || (artifacts.prNumber ? `#${artifacts.prNumber}` : '—'))}</div>
          <div><strong>Summary:</strong> ${escapeHtml(summarizeRunRequestResult(data, run))}</div>
        </div>`;
      const line = lifecycle.displayLabel;
      const finalOutputPath = firstNonEmpty(data?.output_path, run?.output_path);
      let viewUrl = null;
      if (['completed','failed','cancelled','needs_review','completed_with_gaps'].includes(lifecycle.displayStatus) && finalOutputPath) {
        const rel = String(finalOutputPath).replace('/Users/chrixchange/.openclaw/workspace/', '');
        viewUrl = `http://127.0.0.1:45680/view-run-output.html?path=${encodeURIComponent(rel)}&role=${encodeURIComponent(data.role_label || '')}&id=${encodeURIComponent(data.id || '')}`;
      }
      setRunStatusUI({ status: lifecycle.displayStatus, line, detailHtml, viewUrl });
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

  setStatus(`<span class="dot"></span> Run request queued for ${escapeHtml(role)} (notified #${notifyChannel})`);
  setButtonBusy(runBtn, false);
  setTimeout(() => closePromptModal(), 1400);
  await boot();
}

function assignTaskToSuggestedAgent() {
  const currentId = taskModalState.editingId;
  const item = state.workItems.find(w => w.id === currentId) || {
    title: el('task-title')?.value?.trim() || '',
    domain: el('task-domain')?.value || 'exec',
    priority: el('task-priority')?.value || 'normal',
    status: el('task-status')?.value || 'inbox',
    description: el('task-description')?.value?.trim() || ''
  };
  const role = suggestRoleForTask(item);
  el('task-owner-role').value = role;

  // Reviewer automation (matches SecOpsAI orchestration rules)
  const requiresSec = !!(item?.requires_security_review ?? el('task-security-review')?.checked);
  const externalFacing = !!(item?.external_facing ?? el('task-external-facing')?.checked);
  const currentReviewer = (el('task-reviewer-role')?.value || '').trim();
  if (!currentReviewer) {
    if (requiresSec) el('task-reviewer-role').value = 'security/security-engineer';
    else if (externalFacing) el('task-reviewer-role').value = 'product/product-manager';
  }

  setStatus(`<span class="dot"></span> Suggested owner set to ${escapeHtml(role)}`);
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
  const approvedArtifacts = state.artifacts.filter(a => a.approval_status === 'approved').length;
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
        <div class="metric-label">Items that need careful product/security review</div>
      </div>
      <div class="card">
        <h3>Approved artifacts</h3>
        <div class="metric">${approvedArtifacts}</div>
        <div class="metric-label">Reusable outputs already marked approved</div>
      </div>
    `;

    el('mc-external-facing')?.addEventListener('click', () => {
      setPage('tasks');
      if (el('task-filter-external')) el('task-filter-external').checked = true;
      if (el('task-filter-status')) el('task-filter-status').value = '';
      renderTasks();
    });
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

function renderOrgMap() {
  const latest = latestRunByRole(state.runs);
  const groups = cfg.roleGroups || {};
  const host = el("org-map-groups");
  if (!host) return;
  host.innerHTML = "";

  Object.entries(groups).forEach(([dept, roles]) => {
    const wrap = document.createElement("section");
    wrap.className = "role-group";
    wrap.innerHTML = `<h3>${escapeHtml(dept)}</h3><div class="grid cols-3" id="org-${dept}"></div>`;
    host.appendChild(wrap);
    const grid = wrap.querySelector(`#org-${dept}`);

    roles.forEach(role => {
      const run = latest.get(role);
      const card = document.createElement("div");
      card.className = "card role-card";
      card.style.borderColor = `${cfg.departments?.[dept] || '#06b6d4'}33`;
      const hasRun = !!run;
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
          <div>
            <div class="role">${escapeHtml(role)}</div>
            <div class="dept">${escapeHtml(dept)}</div>
          </div>
          <div class="status-pill" style="padding:6px 10px; font-size:0.78rem;">${escapeHtml(hasRun ? (run?.status || '—') : 'Not run yet')}</div>
        </div>
        <div class="mini">
          <div><span>Last task:</span> ${escapeHtml(hasRun ? (run?.task_summary || '—') : 'Not run yet')}</div>
          <div><span>Last active:</span> ${escapeHtml(hasRun ? (run?.created_at ? fmtDate(run.created_at) : '—') : 'Never')}</div>
        </div>
        <div class="task-card-actions">
          <button class="mini-btn" data-action="brief" data-role="${escapeHtml(role)}" data-dept="${escapeHtml(dept)}">Brief</button>
          <button class="mini-btn" data-action="copy-brief" data-role="${escapeHtml(role)}" data-dept="${escapeHtml(dept)}">Copy brief</button>
        </div>
      `;

      card.addEventListener('click', async (event) => {
        const action = event.target?.dataset?.action;
        if (!action) return;
        event.stopPropagation();
        const roleLabel = event.target.dataset.role;
        const deptName = event.target.dataset.dept;
        // Build a lightweight work item stub so we can reuse the existing prompt modal.
        const stub = {
          id: null,
          title: `Quick task for ${roleLabel}`,
          domain: deptName,
          priority: 'normal',
          status: 'inbox',
          owner_role: roleLabel,
          reviewer_role: null,
          description: ''
        };
        openPromptModal(stub, roleLabel);
        if (action === 'copy-brief') {
          // allow DOM update
          setTimeout(() => copyPromptToClipboard(), 0);
        }
      });

      grid.appendChild(card);
    });
  });
}

function renderAgents() {
  const latest = latestRunByRole(state.runs);
  const groups = cfg.roleGroups || {};
  const host = el("agents-groups");
  if (!host) return;
  host.innerHTML = "";

  const completedRuns = state.runs.filter(r => r.status === 'completed').length;
  const failedRuns = state.runs.filter(r => r.status === 'failed').length;
  const uniqueRoles = new Set(state.runs.map(r => r.role_label)).size;
  const agentSummary = el("agent-summary");
  if (agentSummary) {
    agentSummary.innerHTML = `
      <div class="card"><div class="metric">${state.runs.length}</div><div class="metric-label">Tracked runs</div></div>
      <div class="card"><div class="metric">${uniqueRoles}</div><div class="metric-label">Roles with activity</div></div>
      <div class="card"><div class="metric">${completedRuns}</div><div class="metric-label">Completed runs</div></div>
      <div class="card"><div class="metric">${failedRuns}</div><div class="metric-label">Failed runs</div></div>
    `;
  }

  Object.entries(groups).forEach(([dept, roles]) => {
    const wrap = document.createElement("section");
    wrap.className = "role-group";
    wrap.innerHTML = `<h3>${dept}</h3><div class="grid cols-3" id="group-${dept}"></div>`;
    host.appendChild(wrap);
    const grid = wrap.querySelector(`#group-${dept}`);

    roles.forEach(role => {
      const run = latest.get(role);
      const card = document.createElement("div");
      card.className = "card role-card";
      card.style.borderColor = `${cfg.departments?.[dept] || '#06b6d4'}33`;
      const hasRun = !!run;
      card.innerHTML = `
        <div class="role">${escapeHtml(role)}</div>
        <div class="dept">${escapeHtml(dept)}</div>
        <div class="mini">
          <div><span>Last task:</span> ${escapeHtml(hasRun ? (run?.task_summary || '—') : 'Not run yet')}</div>
          <div><span>Status:</span> ${escapeHtml(hasRun ? (run?.status || '—') : 'Not run yet')}</div>
          <div><span>Runtime:</span> ${escapeHtml(hasRun ? (run?.runtime || '—') : '—')}</div>
          <div><span>Model:</span> ${escapeHtml(hasRun ? (run?.model_used || '—') : '—')}</div>
          <div><span>Last active:</span> ${escapeHtml(hasRun ? (run?.created_at ? fmtDate(run.created_at) : '—') : 'Never')}</div>
        </div>
      `;
      grid.appendChild(card);
    });
  });
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
            ${item.owner_role ? `<span class="badge">${escapeHtml(item.owner_role)}</span>` : ''}
            ${item.external_facing ? `<span class="badge external">external-facing</span>` : ''}
            ${item.requires_security_review ? `<span class="badge review">security review</span>` : ''}
          </div>
          <div class="small" style="margin-top:10px;">Updated ${escapeHtml(fmtDate(item.updated_at || item.created_at))}</div>
          <div class="task-card-actions">
            <button class="mini-btn" data-action="assign">Assign</button>
            <button class="mini-btn" data-action="prompt">Execute</button>
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
          if (action === 'assign') { event.stopPropagation(); const role = suggestRoleForTask(item); const reviewer = item?.reviewer_role || ((item?.requires_security_review) ? 'security/security-engineer' : (item?.external_facing ? 'product/product-manager' : null)); const payload = { ...item, owner_role: role, reviewer_role: reviewer || null, updated_at: new Date().toISOString() }; Promise.resolve().then(async () => { const { data, error } = await supabaseClient.from('work_items').update({ owner_role: payload.owner_role, reviewer_role: payload.reviewer_role, updated_at: payload.updated_at }).eq('id', item.id).select().single(); if (error) throw error; upsertWorkItemInState(data); refreshTaskViewsOnly(); setStatus(`<span class="dot"></span> Suggested owner set to ${escapeHtml(role)}`); }).catch(err => { console.error('assign suggested owner failed', err); alert(`Failed to assign suggested owner: ${err.message || err}`); }); return; }
          if (action === 'prompt') { event.stopPropagation(); openPromptModal(item); return; }
          openTaskModal(item);
        });
        list.appendChild(div);
      });
    }
    board.appendChild(col);
  });
}

async function removeFinding(findingId) {
  const finding = state.findings.find(f => String(f.id) === String(findingId));
  if (!findingId || !finding) return;
  if (!confirm(`Remove this finding: ${findingTitle(finding)}?`)) return;
  const { error } = await supabaseClient.from('findings').delete().eq('id', findingId);
  if (error) return alert(`Failed to remove finding: ${error.message}`);
  state.findings = state.findings.filter(f => String(f.id) !== String(findingId));
  if (String(state.selectedFindingId || '') === String(findingId)) {
    state.selectedFindingId = state.findings[0]?.id || null;
  }
  renderFindings();
  setStatus(`<span class="dot"></span> Finding removed`);
  Promise.resolve().then(() => createDashboardEvent('finding_removed', `Finding removed`, findingTitle(finding), 'warning', { related_run_id: finding.run_id || finding.related_run_id || null, related_work_item_id: finding.related_work_item_id || finding.work_item_id || null })).catch(e => console.warn('finding_removed event failed', e));
}

function renderFindings() {
  const findingsAvailable = state.optionalTables.findings !== false;
  if (findingsAvailable && state.findings.length && !state.selectedFindingId) selectFinding();
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
            const selected = String(state.selectedFindingId) === String(f.id);
            return `<tr class="finding-row ${selected ? 'selected-row' : ''}" data-finding-id="${escapeHtml(f.id || '')}">
              <td><strong>${escapeHtml(findingTitle(f))}</strong><div class="small">${escapeHtml(findingSource(f))}${findingConfidence(f) !== null ? ` • confidence ${escapeHtml(findingConfidence(f))}` : ''}</div><div class="small">${escapeHtml(findingBody(f).slice(0, 120) || '—')}</div></td>
              <td><span class="badge priority-${String(findingSeverity(f)).toLowerCase() === 'critical' ? 'urgent' : String(findingSeverity(f)).toLowerCase() === 'high' ? 'high' : 'normal'}">${escapeHtml(findingSeverity(f))}</span></td>
              <td>${renderStatusPill(String(findingStatus(f)).toLowerCase(), humanizeSnake(findingStatus(f)))}</td>
              <td>${best ? `<div class="small"><strong>${best.score}</strong> match</div><div class="small">${escapeHtml(best.reasons.join(' • '))}</div>` : '<span class="small">No strong match yet</span>'}</td>
              <td>${related.length ? related.slice(0, 2).map(match => `<div class="small">${escapeHtml(match.item.title)} <span class="muted-inline">(${escapeHtml(match.item.status || 'unknown')})</span></div>`).join('') : '<span class="small">No linked task yet</span>'}</td>
              <td><div class="task-card-actions"><button class="mini-btn finding-select-btn" data-finding-id="${escapeHtml(f.id || '')}">Inspect</button><button class="mini-btn finding-task-btn" data-finding-id="${escapeHtml(f.id || '')}">Create task</button><button class="mini-btn finding-remove-btn" data-finding-id="${escapeHtml(f.id || '')}">Remove</button></div></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`;
      table.querySelectorAll('.finding-task-btn').forEach(btn => btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const finding = state.findings.find(f => String(f.id) === String(btn.dataset.findingId));
        if (finding) openFindingTaskModal(finding);
      }));
      table.querySelectorAll('.finding-remove-btn').forEach(btn => btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        await removeFinding(btn.dataset.findingId);
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
      intel.innerHTML = `<div class="empty">Correlation detail will appear here once the optional <code>findings</code> table exists.</div>`;
      return;
    }
    if (!selected) {
      intel.innerHTML = `<div class="empty">Select a finding to inspect correlation, related requests, and suggested next actions.</div>`;
      return;
    }
    const related = relatedTasksForFinding(selected);
    const requests = correlatedRunRequestsForFinding(selected);
    intel.innerHTML = `
      <div class="finding-detail-header">
        <div>
          <h4>${escapeHtml(findingTitle(selected))}</h4>
          <div class="small">${escapeHtml(findingSource(selected))} • ${escapeHtml(fmtDate(findingDetectedAt(selected)))}${findingFingerprint(selected) ? ` • ${escapeHtml(findingFingerprint(selected))}` : ''}</div>
          <div class="small" style="margin-top:10px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;"><span class="muted-inline">Selected finding status:</span>${renderStatusPill(String(findingStatus(selected)).toLowerCase(), humanizeSnake(findingStatus(selected)))}</div>
        </div>
      </div>
      <div class="finding-detail-grid">
        <div class="card finding-detail-card">
          <h4>Overview</h4>
          <div class="kv-list">
            <div class="kv-row"><div class="kv-key">Severity</div><div class="kv-val">${escapeHtml(findingSeverity(selected))}</div></div>
            <div class="kv-row"><div class="kv-key">Confidence</div><div class="kv-val">${escapeHtml(findingConfidence(selected) ?? '—')}</div></div>
            <div class="kv-row"><div class="kv-key">Suggested domain</div><div class="kv-val">${escapeHtml(findingDomainHint(selected))}</div></div>
          </div>
          <div class="small" style="margin-top:12px;">${escapeHtml(findingBody(selected) || 'No additional finding narrative available.')}</div>
        </div>
        <div class="card finding-detail-card">
          <h4>Task linkage</h4>
          ${related.length ? related.map(match => `<div class="feed-item"><div><strong>${escapeHtml(match.item.title)}</strong></div><div class="small">${escapeHtml(match.item.status || 'unknown')} • score ${match.score}</div><div class="small">${escapeHtml(match.reasons.join(' • '))}</div></div>`).join('') : '<div class="empty">No convincing task match yet. Create a dedicated investigation task.</div>'}
        </div>
      </div>
      <div class="card finding-detail-card" style="margin-top:14px;">
        <h4>Run-request correlation</h4>
        ${requests.length ? requests.map(match => `<div class="feed-item"><div><strong>${escapeHtml(match.request.role_label)}</strong></div><div class="small">${escapeHtml(match.request.status || 'queued')} • score ${match.score}</div><div class="small">${escapeHtml((match.request.prompt_text || '').slice(0, 180) || '—')}</div></div>`).join('') : '<div class="empty">No strong run-request overlap yet. This gracefully stays empty when the queue or text hints are absent.</div>'}
        <div class="task-card-actions" style="margin-top:14px;"><button class="mini-btn" id="selected-finding-task-btn">Create investigation task</button>${related[0]?.item ? `<button class="mini-btn" id="selected-finding-prompt-btn">Open top task brief</button>` : ''}<button class="mini-btn" id="selected-finding-remove-btn">Remove finding</button></div>
      </div>
    `;
    el('selected-finding-task-btn')?.addEventListener('click', () => openFindingTaskModal(selected));
    el('selected-finding-prompt-btn')?.addEventListener('click', () => {
      const top = related[0]?.item;
      if (top) openPromptModal(top);
    });
    el('selected-finding-remove-btn')?.addEventListener('click', () => removeFinding(selected.id));
  }
}

function renderArtifacts() {
  const host = el("artifacts-table");
  if (!host) return;
  host.innerHTML = `
    <div class="page-header compact-header">
      <div>
        <h3 style="margin:0;">Artifact registry</h3>
        <p class="small" style="margin:6px 0 0;">Create and edit reusable specs, reports, copy, and linked outputs.</p>
      </div>
      <div class="status-pill" id="new-artifact-btn" style="cursor:pointer;"><span class="dot"></span> New artifact</div>
    </div>
  `;

  if (!state.artifacts.length) {
    host.innerHTML += `<div class="empty">No artifacts yet.</div>`;
    return;
  }

  host.innerHTML += `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Title</th><th>Type / output</th><th>Approval</th><th>Audience</th><th>Work item</th><th>Run</th><th>Path / URL</th><th>Created</th></tr></thead>
        <tbody>${state.artifacts.map(a => {
          const workItem = state.workItems.find(w => w.id === a.work_item_id);
          const run = state.runs.find(r => r.id === a.run_id);
          const summary = `${a.summary || ''}`.toLowerCase();
          const audience = summary.includes('customer') || a.artifact_type === 'copy' ? 'customer/promoted' : run?.role_label?.startsWith('support/') || run?.role_label?.startsWith('security/') ? 'operator' : 'internal';
          return `
          <tr class="artifact-row" data-artifact-id="${a.id}">
            <td><strong>${escapeHtml(a.title)}</strong><div class="small">${escapeHtml(a.summary || '—')}</div></td>
            <td>${escapeHtml(a.artifact_type)}</td>
            <td>${renderStatusPill(String(a.approval_status || 'draft').toLowerCase(), a.approval_status || 'draft')}</td>
            <td>${escapeHtml(audience)}</td>
            <td>${escapeHtml(workItem?.title || '—')}</td>
            <td>${escapeHtml(run?.role_label || '—')}</td>
            <td>${escapeHtml(a.path_or_url)}</td>
            <td>${escapeHtml(fmtDate(a.created_at))}</td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('.artifact-row').forEach(row => {
    row.addEventListener('click', () => {
      const artifact = state.artifacts.find(a => a.id === row.dataset.artifactId);
      if (artifact) openArtifactModal(artifact);
    });
  });
}

function humanizeSnake(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\w/g, c => c.toUpperCase());
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

function collectRunRequestText(req, run = null) {
  return stripAnsi([
    req?.output_summary,
    req?.error,
    req?.result_text,
    run?.output_summary,
    run?.task_summary,
    run?.task_detail
  ].filter(Boolean).join('\n'));
}

function parseRunRequestArtifacts(req, run = null) {
  const text = collectRunRequestText(req, run);
  const commitMatch = text.match(/\b([a-f0-9]{7,40})\b/i);
  const prUrlMatch = text.match(/https?:\/\/github\.com\/[^\s)]+\/pull\/\d+/i);
  const prNumberMatch = text.match(/\bPR\s*#(\d+)\b/i) || text.match(/\bpull request\s*#?(\d+)\b/i);
  const changedMatch = text.match(/(?:files? changed|changed files?)\s*[:\-]?\s*(\d{1,4})\b/i)
    || text.match(/(\d{1,4})\s+files? changed\b/i);
  const summaryMatch = text.match(/(?:summary|result|outcome)\s*[:\-]\s*([^\n]{12,220})/i);
  return {
    commit: commitMatch ? commitMatch[1] : firstNonEmpty(req?.commit_hash, run?.commit_hash),
    prUrl: prUrlMatch ? prUrlMatch[0] : firstNonEmpty(req?.pr_url, run?.pr_url),
    prNumber: prNumberMatch ? prNumberMatch[1] : firstNonEmpty(req?.pr_number, run?.pr_number),
    filesChanged: changedMatch ? changedMatch[1] : firstNonEmpty(req?.files_changed, run?.files_changed),
    summary: firstNonEmpty(req?.output_summary, run?.output_summary, summaryMatch ? summaryMatch[1] : '')
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
  const rawStatus = String(req?.status || '').toLowerCase();
  const parsedOutput = tryParseJsonBlob(req?.output_summary);
  const aborted = !!parsedOutput?.result?.meta?.aborted;
  const outcomeText = collectRunRequestText(req, run).toLowerCase();
  const badPatterns = [
    /i can't fulfil/, /i can't fulfill/, /cannot fulfill/, /can't comply/, /cannot comply/,
    /i can.t help with that/, /i can.t assist with that/, /refus/, /unable to complete/,
    /could not complete/, /blocked/, /need[s]? review/, /not enough context/,
    /waiting on/, /missing access/, /requires approval/, /incomplete/, /partial/
  ];
  const successPatterns = [/completed successfully/, /done\b/, /finished\b/, /opened pr/, /commit(ed)?\b/, /files? changed\b/];
  const hasBadOutcome = badPatterns.some(rx => rx.test(outcomeText));
  const hasPositiveEvidence = successPatterns.some(rx => rx.test(outcomeText));

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
  } else if (rawStatus === 'completed' && !hasPositiveEvidence) {
    displayStatus = 'completed_with_gaps';
    displayLabel = 'Completed (low proof)';
    outcomeHint = 'Completed with limited proof in the available fields. Check related run, output path, or summary.';
  } else if (rawStatus === 'completed') {
    outcomeHint = 'Completion evidence found in output summary or related run metadata.';
  }

  const evidence = [
    req?.created_at ? `Requested ${fmtDate(req.created_at)}` : null,
    (req?.picked_up_at || run?.started_at) ? `Picked up ${fmtDate(req?.picked_up_at || run?.started_at)}` : null,
    req?.updated_at ? `Last update ${fmtDate(req.updated_at)}` : null,
    (req?.completed_at || run?.completed_at) ? `Finished ${fmtDate(req?.completed_at || run?.completed_at)}` : null,
    aborted ? 'Output metadata says the worker was aborted' : null
  ].filter(Boolean);

  return { rawStatus, hasBadOutcome, hasPositiveEvidence, displayStatus, displayLabel, outcomeHint, evidence };
}

function summarizeRunRequestResult(req, run = null) {
  const text = firstNonEmpty(req?.output_summary, req?.error, run?.output_summary, run?.task_summary);
  if (!text) {
    return req?.status === 'queued' ? 'Waiting for dispatcher / worker pickup' : '—';
  }
  return compactText(stripAnsi(text), 160);
}

async function removeRunRequest(requestId) {
  const req = state.runRequests.find(r => r.id === requestId);
  if (!req) return;
  const actionLabel = ['queued', 'failed', 'cancelled', 'completed'].includes(String(req.status || '').toLowerCase()) ? 'remove' : 'delete';
  if (!confirm(`Remove this run request${req.role_label ? ` for ${req.role_label}` : ''}?`)) return;
  const { error } = await supabaseClient.from('run_requests').delete().eq('id', requestId);
  if (error) return alert(`Failed to remove run request: ${error.message}`);
  state.runRequests = state.runRequests.filter(r => r.id !== requestId);
  renderRunRequests();
  renderIntegrations();
  setStatus(`<span class="dot"></span> Run request removed`);
  Promise.resolve().then(() => createDashboardEvent('run_request_removed', `Run request removed`, `${req.role_label || 'Unknown role'} • ${req.id}`, 'info', { related_run_id: req.related_run_id || null, related_work_item_id: req.related_work_item_id || null })).catch(e => console.warn('run_request_removed event failed', e));
}

async function cancelRunRequest(requestId) {
  const req = state.runRequests.find(r => r.id === requestId);
  if (!req) return;
  if (!confirm(`Cancel queued run request${req.role_label ? ` for ${req.role_label}` : ''}?`)) return;
  const { data, error } = await supabaseClient.from('run_requests').update({ status: 'cancelled' }).eq('id', requestId).select().single();
  if (error) return alert(`Failed to cancel run request: ${error.message}`);
  const idx = state.runRequests.findIndex(r => r.id === requestId);
  if (idx >= 0) state.runRequests[idx] = data;
  renderRunRequests();
  renderIntegrations();
  setStatus(`<span class="dot"></span> Run request cancelled`);
  Promise.resolve().then(() => createDashboardEvent('run_request_cancelled', `Run request cancelled`, `${req.role_label || 'Unknown role'} • ${req.id}`, 'warning', { related_run_id: req.related_run_id || null, related_work_item_id: req.related_work_item_id || null })).catch(e => console.warn('run_request_cancelled event failed', e));
}

function renderRunRequests() {
  const host = el('run-requests-table');
  if (!host) return;
  if (state.optionalTables.run_requests === false) {
    host.innerHTML = `<div class="empty">The run requests table is not available yet. Apply the migration and this panel will start showing queue state.</div>`;
    return;
  }
  if (!state.runRequests.length) {
    host.innerHTML = `<div class="empty">No run requests yet. Use “Run now” from an intelligent brief to populate this queue.</div>`;
    return;
  }
  host.innerHTML = `
    <div class="table-wrap"><table class="run-requests-grid">
      <thead><tr><th>Lifecycle proof</th><th>Request</th><th>Worker / Run</th><th>Paths / Output</th><th>Result evidence</th><th>Actions</th></tr></thead>
      <tbody>${state.runRequests.map(req => {
        const workItem = state.workItems.find(w => w.id === req.related_work_item_id);
        const run = relatedRunForRequest(req);
        const lifecycle = runRequestLifecycle(req, run);
        const artifacts = parseRunRequestArtifacts(req, run);
        const worker = runRequestWorkerIdentity(req, run);
        const canCancel = ['queued', 'running', 'picked_up'].includes(String(lifecycle.displayStatus || '').toLowerCase());
        return `<tr>
          <td>
            ${renderStatusPill(lifecycle.displayStatus, lifecycle.displayLabel)}
            ${lifecycle.outcomeHint ? `<div class="small rr-sub" style="margin-top:8px;">${escapeHtml(lifecycle.outcomeHint)}</div>` : ''}
            ${lifecycle.evidence.length ? `<div class="small rr-proof-list">${lifecycle.evidence.map(line => `<div>${escapeHtml(line)}</div>`).join('')}</div>` : ''}
          </td>
          <td>
            <div class="rr-main"><strong>${escapeHtml(req.role_label || 'Unknown role')}</strong></div>
            <div class="small rr-sub">${escapeHtml(summarizePromptText(req.prompt_text))}</div>
            <div class="small rr-meta">${escapeHtml(fmtDate(req.created_at))}</div>
            <div class="small rr-proof-list" style="margin-top:8px;">
              <div><strong>Task:</strong> ${escapeHtml(workItem?.title || '—')}</div>
              <div>${req.related_work_item_id ? `Work item ${escapeHtml(String(req.related_work_item_id))}` : 'No linked task id'}</div>
              <div>${escapeHtml(req.suggested_channel_name ? `Suggested route #${req.suggested_channel_name}` : 'No suggested route')}</div>
            </div>
          </td>
          <td>
            <div class="rr-main">${escapeHtml(worker || 'Worker unknown')}</div>
            <div class="small rr-sub">${escapeHtml(run?.runtime || req?.initiated_by || 'dashboard')}</div>
            <div class="small rr-proof-list" style="margin-top:8px;">
              <div>${req.related_run_id ? `Related run ${escapeHtml(String(req.related_run_id))}` : 'No related run id'}</div>
              <div>${escapeHtml(firstNonEmpty(run?.source_surface, run?.source_channel_id) || 'No source surface metadata')}</div>
              <div>${escapeHtml(firstNonEmpty(run?.model_used, req?.agent_model) || 'No model/agent field')}</div>
            </div>
          </td>
          <td>
            <div class="small rr-proof-list">
              <div><strong>Repo:</strong> ${escapeHtml(firstNonEmpty(req?.repo_path, run?.repo_path) || '—')}</div>
              <div><strong>Output:</strong> ${escapeHtml(firstNonEmpty(req?.output_path, run?.output_path) || '—')}</div>
              <div><strong>Summary:</strong> ${escapeHtml(compactText(artifacts.summary || summarizeRunRequestResult(req, run), 120))}</div>
            </div>
          </td>
          <td>
            <div class="small rr-result">${escapeHtml(summarizeRunRequestResult(req, run))}</div>
            <div class="small rr-proof-list" style="margin-top:8px;">
              <div><strong>Files changed:</strong> ${escapeHtml(String(artifacts.filesChanged || '—'))}</div>
              <div><strong>Commit:</strong> ${escapeHtml(artifacts.commit || '—')}</div>
              <div><strong>PR:</strong> ${escapeHtml(artifacts.prUrl || (artifacts.prNumber ? `#${artifacts.prNumber}` : '—'))}</div>
            </div>
          </td>
          <td>
            <div class="task-card-actions rr-actions">
              ${canCancel ? `<button class="mini-btn" data-runreq-action="cancel" data-runreq-id="${escapeHtml(req.id)}">Cancel</button>` : ''}
              <button class="mini-btn" data-runreq-action="remove" data-runreq-id="${escapeHtml(req.id)}">Remove</button>
            </div>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

  host.querySelectorAll('[data-runreq-action]').forEach(btn => {
    btn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = event.currentTarget.dataset.runreqId;
      const action = event.currentTarget.dataset.runreqAction;
      if (!id || !action) return;
      if (action === 'cancel') return cancelRunRequest(id);
      if (action === 'remove') return removeRunRequest(id);
    });
  });
}

function renderIntegrations() {
  const summary = el('integration-summary');
  const discordStatus = state.integrationStatus?.discord || {};
  const discordWebhookCount = ['ops-log', 'kanban-updates'].filter(name => discordStatus[name]).length;
  const queuedRequests = state.runRequests.filter(r => r.status === 'queued').length;
  const runningRequests = state.runRequests.filter(r => r.status === 'running').length;
  if (summary) {
    summary.innerHTML = `
      <div class="card"><div class="metric">${state.channelRoutes.length}</div><div class="metric-label">Channel routes</div></div>
      <div class="card"><div class="metric">${state.channelRoutes.filter(r => r.active).length}</div><div class="metric-label">Active routes</div></div>
      <div class="card"><div class="metric">${queuedRequests}</div><div class="metric-label">Queued run requests</div></div>
      <div class="card"><div class="metric">${runningRequests}</div><div class="metric-label">Running run requests</div></div>`;
  }

  const cfgEl = el('integration-config');
  if (cfgEl) {
    cfgEl.innerHTML = `
      <div class="card">
        <h3>Supabase</h3>
        <div class="kv-list">
          <div class="kv-row"><div class="kv-key">Project URL</div><div class="kv-val">${escapeHtml(cfg.supabaseUrl)}</div></div>
          <div class="kv-row"><div class="kv-key">Anon key</div><div class="kv-val">Configured</div></div>
          <div class="kv-row"><div class="kv-key">Connection</div><div class="kv-val good">Ready</div></div>
        </div>
      </div>
      <div class="card">
        <h3>Audit notifications</h3>
        <div class="kv-list">
          <div class="kv-row"><div class="kv-key">Server ID</div><div class="kv-val">${escapeHtml(cfg.serverId || '—')}</div></div>
          <div class="kv-row"><div class="kv-key">Notification mode</div><div class="kv-val">${escapeHtml(discordStatus.mode || 'local-helper')}</div></div>
          <div class="kv-row"><div class="kv-key">ops-log webhook</div><div class="kv-val">${discordStatus['ops-log'] ? 'Configured' : 'Missing'}</div></div>
          <div class="kv-row"><div class="kv-key">kanban-updates webhook</div><div class="kv-val">${discordStatus['kanban-updates'] ? 'Configured' : 'Missing'}</div></div>
          <div class="kv-row"><div class="kv-key">Last test</div><div class="kv-val">${escapeHtml(state.lastDiscordTest?.summary || 'Not run yet')}</div></div>
        </div>
        <div class="integration-actions">
          <button id="test-ops-log-btn" class="secondary-btn">Send ops-log test</button>
          <button id="test-kanban-btn" class="secondary-btn">Send kanban-updates test</button>
        </div>
        <div id="discord-test-status" class="small" style="margin-top:12px;">${escapeHtml(state.lastDiscordTest?.detail || 'Use the buttons to verify audit-notification delivery. Live conversations should stay in OpenClaw.')}</div>
      </div>`;
  }

  const table = el('routes-table');
  if (!table) return;
  if (!state.channelRoutes.length) {
    table.innerHTML = `<div class="empty">No channel routes found.</div>`;
    return;
  }
  table.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Channel</th><th>Channel ID</th><th>Default role</th><th>Override</th><th>Summaries</th><th>Run logs</th><th>Local helper route</th><th>Active</th></tr></thead>
      <tbody>${state.channelRoutes.map(r => `
        <tr>
          <td>${escapeHtml(r.channel_name)}</td>
          <td>${escapeHtml(r.channel_id)}</td>
          <td>${escapeHtml(r.default_role_label)}</td>
          <td>${r.allow_orchestrator_override ? 'Yes' : 'No'}</td>
          <td>${r.post_summaries ? 'Yes' : 'No'}</td>
          <td>${r.post_run_logs ? 'Yes' : 'No'}</td>
          <td>${discordStatus[r.channel_name] ? 'Yes' : 'No'}</td>
          <td>${r.active ? 'Yes' : 'No'}</td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}

function renderAll() {
  renderMissionControl();
  renderOrgMap();
  renderAgents();
  renderTasks();
  renderFindings();
  renderArtifacts();
  renderRunRequests();
  renderIntegrations();
  setStatus(`<span class="dot"></span> Supabase connected • ${state.channelRoutes.length} routes loaded`);
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

async function backgroundRefreshOpsData() {
  try {
    const [runs, events] = await Promise.all([
      loadTable('agent_runs', { orderBy: { column: 'created_at', ascending: false }, limit: 200 }),
      loadTable('dashboard_events', { orderBy: { column: 'created_at', ascending: false }, limit: 100 })
    ]);
    state.runs = runs;
    state.events = events;
    renderMissionControl();
    renderAgents();
    renderIntegrations();
    renderArtifacts();
    renderFindings();
  } catch (e) {
    console.warn('background ops refresh failed', e);
  }
}

function resetArtifactForm() {
  artifactModalState.editingId = null;
  el('artifact-modal-title').textContent = 'New artifact';
  el('artifact-title').value = '';
  el('artifact-type').value = 'spec';
  el('artifact-path').value = '';
  el('artifact-summary').value = '';
  el('artifact-approval-status').value = 'draft';
  if (el('artifact-approved-by-role')) el('artifact-approved-by-role').innerHTML = ROLE_OPTIONS_HTML;
  el('artifact-approved-by-role').value = '';
  el('artifact-work-item-id').innerHTML = `<option value="">None</option>${artifactWorkItemOptions().map(o => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('')}`;
  el('artifact-run-id').innerHTML = `<option value="">None</option>${artifactRunOptions().map(o => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('')}`;
  el('artifact-delete-btn').classList.add('hidden');
}

function openArtifactModal(item = null) {
  resetArtifactForm();
  if (item) {
    artifactModalState.editingId = item.id;
    el('artifact-modal-title').textContent = 'Edit artifact';
    el('artifact-title').value = item.title || '';
    el('artifact-type').value = item.artifact_type || 'spec';
    el('artifact-path').value = item.path_or_url || '';
    el('artifact-summary').value = item.summary || '';
    el('artifact-approval-status').value = item.approval_status || 'draft';
    el('artifact-approved-by-role').value = item.approved_by_role || '';
    el('artifact-work-item-id').value = item.work_item_id || '';
    el('artifact-run-id').value = item.run_id || '';
    el('artifact-delete-btn').classList.remove('hidden');
  }
  el('artifact-modal').classList.remove('hidden');
}

function closeArtifactModal() { el('artifact-modal').classList.add('hidden'); }

function buildDiscordMessage(title, lines = []) {
  return [`**${title}**`, ...lines.filter(Boolean)].join('\n');
}

function formatDiscordError(data, fallbackStatus) {
  if (data?.errorDetail?.discord_code === 1010) {
    return 'Discord/Cloudflare blocked the webhook request from this machine (code 1010).';
  }
  if (data?.errorDetail?.http_status) {
    return `Discord webhook HTTP ${data.errorDetail.http_status}${data.errorDetail.discord_code ? ` (code ${data.errorDetail.discord_code})` : ''}`;
  }
  return data?.error || `Discord notify HTTP ${fallbackStatus}`;
}

async function postDiscordUpdate(channelName, content) {
  try {
    const res = await fetch(cfg.discordNotifyEndpoint || '/api/discord-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelName, content })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const message = formatDiscordError(data, res.status);
      return { ok: false, reason: message, skipped: data.skipped || false };
    }
    return data;
  } catch (error) {
    console.error(`Discord post failed for ${channelName}`, error);
    return { ok: false, reason: error.message || String(error) };
  }
}

async function loadIntegrationStatus() {
  try {
    const res = await fetch(cfg.integrationStatusEndpoint || '/api/integration-status');
    if (!res.ok) throw new Error(`Integration status HTTP ${res.status}`);
    state.integrationStatus = await res.json();
  } catch (error) {
    console.error('integration status load failed', error);
    state.integrationStatus = { ok: false, discord: { mode: 'local-helper', 'ops-log': false, 'kanban-updates': false } };
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
    model_used: 'dashboard-orchestrator',
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
    relatedWorkItemId: item?.id || null,
    sourceChannelName: 'ops-log'
  });

  const opsResult = await postDiscordUpdate('ops-log', buildDiscordMessage(details.title, [details.body, `Role: exec/agents-orchestrator`, run?.id ? `Run ID: ${run.id}` : null]));
  if (!opsResult.ok && !opsResult.skipped) console.warn('ops-log notification failed:', opsResult.reason);
  if (kind === 'task_moved' || kind === 'task_created' || kind === 'task_deleted' || kind === 'task_updated') {
    const kanbanResult = await postDiscordUpdate('kanban-updates', buildDiscordMessage(details.kanbanTitle || details.title, [details.kanbanBody || details.body]));
    if (!kanbanResult.ok && !kanbanResult.skipped) console.warn('kanban notification failed:', kanbanResult.reason);
  }
  return { event, run };
}

async function announceArtifactChange(kind, artifact, details, severity = 'info') {
  await createDashboardEvent(kind, details.title, details.body, severity, { related_run_id: artifact?.run_id || null, related_work_item_id: artifact?.work_item_id || null });
  const run = await createOrchestratorRun({
    taskSummary: details.runSummary,
    taskDetail: details.runDetail,
    outputSummary: details.outputSummary,
    relatedWorkItemId: artifact?.work_item_id || null,
    outputPath: artifact?.path_or_url || null,
    sourceChannelName: 'ops-log'
  });
  const opsResult = await postDiscordUpdate('ops-log', buildDiscordMessage(details.title, [details.body, artifact?.path_or_url ? `Artifact: ${artifact.path_or_url}` : null, run?.id ? `Run ID: ${run.id}` : null]));
  if (!opsResult.ok && !opsResult.skipped) console.warn('artifact ops-log notification failed:', opsResult.reason);
  return run;
}

async function runDiscordTest(channelName) {
  const result = await postDiscordUpdate(channelName, buildDiscordMessage('SecOpsAI dashboard test', [`Channel: ${channelName}`, `Sent at: ${new Date().toLocaleString()}`]));
  if (result.ok) {
    state.lastDiscordTest = {
      summary: `${channelName} test ok`,
      detail: `Delivered through local helper at ${new Date().toLocaleTimeString()}.`
    };
    await createDashboardEvent('discord_test_ok', `Discord test ok: ${channelName}`, 'Local helper accepted the test notification.', 'success');
  } else {
    state.lastDiscordTest = {
      summary: `${channelName} test failed`,
      detail: result.reason || 'Unknown Discord delivery failure.'
    };
    await createDashboardEvent('discord_test_failed', `Discord test failed: ${channelName}`, result.reason || 'Unknown Discord delivery failure.', 'error');
  }
  renderIntegrations();
}

async function saveTask() {
  const sourceFinding = taskModalState.sourceFinding;
  const saveBtn = el('task-save-btn');
  if (saveBtn) saveBtn.disabled = true;
  const payload = {
    title: el('task-title').value.trim(),
    domain: el('task-domain').value,
    priority: el('task-priority').value,
    status: el('task-status').value,
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


async function saveArtifact() {
  const payload = {
    title: el('artifact-title').value.trim(),
    artifact_type: el('artifact-type').value,
    path_or_url: el('artifact-path').value.trim(),
    summary: el('artifact-summary').value.trim() || null,
    approval_status: el('artifact-approval-status').value,
    approved_by_role: el('artifact-approved-by-role').value.trim() || null,
    work_item_id: el('artifact-work-item-id').value || null,
    run_id: el('artifact-run-id').value || null
  };
  if (!payload.title || !payload.path_or_url) return alert('Artifact title and path/URL are required.');

  let artifact = null;
  if (artifactModalState.editingId) {
    const { data, error } = await supabaseClient.from('artifacts').update(payload).eq('id', artifactModalState.editingId).select().single();
    if (error) return alert(`Failed to update artifact: ${error.message}`);
    artifact = data;
    await announceArtifactChange('artifact_updated', artifact, {
      title: `Artifact updated: ${payload.title}`,
      body: `${payload.artifact_type} • ${payload.approval_status}`,
      runSummary: `Updated artifact: ${payload.title}`,
      runDetail: payload.summary || 'Artifact updated from dashboard modal.',
      outputSummary: `${payload.artifact_type} marked ${payload.approval_status}`
    }, 'info');
  } else {
    const { data, error } = await supabaseClient.from('artifacts').insert(payload).select().single();
    if (error) return alert(`Failed to create artifact: ${error.message}`);
    artifact = data;
    await announceArtifactChange('artifact_created', artifact, {
      title: `Artifact created: ${payload.title}`,
      body: `${payload.artifact_type} • ${payload.approval_status}`,
      runSummary: `Created artifact: ${payload.title}`,
      runDetail: payload.summary || 'Artifact created from dashboard modal.',
      outputSummary: payload.path_or_url
    }, 'success');
  }
  closeArtifactModal();
  await boot();
}

async function deleteArtifact() {
  if (!artifactModalState.editingId) return;
  const artifact = state.artifacts.find(a => a.id === artifactModalState.editingId);
  if (!confirm('Delete this artifact?')) return;
  const { error } = await supabaseClient.from('artifacts').delete().eq('id', artifactModalState.editingId);
  if (error) return alert(`Failed to delete artifact: ${error.message}`);
  await announceArtifactChange('artifact_deleted', artifact, {
    title: `Artifact deleted: ${artifact?.title || 'Untitled artifact'}`,
    body: 'Artifact removed from registry.',
    runSummary: `Deleted artifact: ${artifact?.title || 'Untitled artifact'}`,
    runDetail: artifact?.summary || 'Artifact deleted from dashboard modal.',
    outputSummary: 'Artifact removed from artifacts table.'
  }, 'warning');
  closeArtifactModal();
  await boot();
}

async function boot() {
  try {
    state.channelRoutes = await loadTable('channel_routes', { orderBy: { column: 'channel_name', ascending: true } });
    state.runs = await loadTable('agent_runs', { orderBy: { column: 'created_at', ascending: false }, limit: 200 });
    state.runRequests = await optionalLoadTable('run_requests', { orderBy: { column: 'created_at', ascending: false }, limit: 100 });
    state.findings = await optionalLoadTable('findings', { orderBy: { column: 'created_at', ascending: false }, limit: 100 });
    state.workItems = await loadTable('work_items', { orderBy: { column: 'updated_at', ascending: false }, limit: 200 });
    state.artifacts = await loadTable('artifacts', { orderBy: { column: 'created_at', ascending: false }, limit: 200 });
    state.events = await loadTable('dashboard_events', { orderBy: { column: 'created_at', ascending: false }, limit: 100 });
    await loadIntegrationStatus();
    renderAll();
  } catch (err) {
    console.error(err);
    setStatus(`Error loading Supabase data: ${err.message || String(err)}`, true);
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
  document.addEventListener('click', (event) => {
    if (event.target?.id === 'new-artifact-btn') openArtifactModal();
    if (event.target?.id === 'test-ops-log-btn') runDiscordTest('ops-log');
    if (event.target?.id === 'test-kanban-btn') runDiscordTest('kanban-updates');
  });
  el('task-modal-close')?.addEventListener('click', closeTaskModal);
  el('task-cancel-btn')?.addEventListener('click', closeTaskModal);
  el('task-save-btn')?.addEventListener('click', saveTask);
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
  el('task-assign-btn')?.addEventListener('click', assignTaskToSuggestedAgent);
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
  el('artifact-modal-close')?.addEventListener('click', closeArtifactModal);
  el('artifact-cancel-btn')?.addEventListener('click', closeArtifactModal);
  el('artifact-save-btn')?.addEventListener('click', saveArtifact);
  el('artifact-delete-btn')?.addEventListener('click', deleteArtifact);
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
  setPage('mission-control');
  if (bootError) {
    setStatus(bootError, true);
    return;
  }
  boot();
});