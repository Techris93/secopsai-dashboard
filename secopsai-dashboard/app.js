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
  workItems: [],
  artifacts: [],
  channelRoutes: [],
  events: [],
  integrationStatus: null,
  lastDiscordTest: null
};

const taskModalState = { editingId: null };
const artifactModalState = { editingId: null };
const promptModalState = { item: null, role: null, brief: null };
const dragState = { taskId: null };
const pages = ["mission-control", "org-map", "agents", "tasks", "artifacts", "integrations"];

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

function buildWorkBrief(item, roleLabel = null) {
  const role = roleLabel || suggestRoleForTask(item);
  const pathHints = ['secopsai-dashboard/index.html','secopsai-dashboard/app.js','secopsai-dashboard/styles.css'];
  const goals = [
    'improve the implementation directly',
    'preserve current working behavior unless a change is required',
    'keep the solution simple and maintainable'
  ];
  if (item?.description) goals.unshift(item.description.trim());
  return `Prepare work for ${role} through the OpenClaw-native orchestrator.

Context: this dashboard is control-plane only; the orchestrator owns live conversations and dispatch.

Task:
- Title: ${item?.title || 'Untitled task'}
- Domain: ${item?.domain || 'exec'}
- Priority: ${item?.priority || 'normal'}
- Status: ${item?.status || 'inbox'}
- Owner role: ${item?.owner_role || 'not set'}
- Reviewer role: ${item?.reviewer_role || 'not set'}

Relevant paths:
${pathHints.map(p => `- ${p}`).join('\n')}

Goals:
${goals.map(g => `- ${g}`).join('\n')}

Return:
- what changed
- files touched
- blockers
- next actions`;
}

function findRouteForRole(roleLabel) {
  return state.channelRoutes.find(r => r.default_role_label === roleLabel && r.active) || null;
}

function openPromptModal(item, roleLabel = null) {
  const role = roleLabel || suggestRoleForTask(item);
  const prompt = buildWorkBrief(item, role);
  promptModalState.item = item;
  promptModalState.role = role;
  promptModalState.brief = prompt;
  el('prompt-modal-title').textContent = 'Work brief';
  const route = findRouteForRole(role);
  const reviewer = item?.reviewer_role || null;
  el('prompt-modal-meta').textContent = `Suggested owner: ${role}${reviewer ? ` • Reviewer: ${reviewer}` : ''}${route ? ` • Route metadata: #${route.channel_name}` : ''} • Direct dashboard-side sending retired`;
  el('prompt-output').value = prompt;
  el('prompt-modal').classList.remove('hidden');
}

function closePromptModal() { el('prompt-modal').classList.add('hidden'); }


async function copyPromptToClipboard() {
  const text = el('prompt-output')?.value || '';
  if (!text) return;
  await navigator.clipboard.writeText(text);
  await createDashboardEvent('work_brief_copied', 'Work brief copied', `Copied work brief for ${promptModalState.role || 'unassigned role'}.`, 'info', { related_work_item_id: promptModalState.item?.id || null });
  setStatus('<span class="dot"></span> Work brief copied to clipboard');
}

async function runPromptNow() {
  const role = promptModalState.role;
  const item = promptModalState.item;
  const prompt = el('prompt-output')?.value || promptModalState.brief || '';
  if (!role || !prompt) return;

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

  // Insert a run_requests queue item (picked up by discord_dispatcher.py).
  try {
    await supabaseClient.from('run_requests').insert({
      role_label: role,
      prompt_text: prompt,
      suggested_channel_name: route?.channel_name || null,
      related_work_item_id: item?.id || null,
      related_run_id: run?.id || null,
      initiated_by: 'dashboard'
    });
  } catch (e) {
    console.warn('run_requests insert failed (table may not exist yet):', e);
  }

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
  if (!result.ok && !result.skipped) {
    // Non-fatal: the run request is already queued in Supabase. Treat Discord notify as best-effort.
    await createDashboardEvent('run_now_notify_failed', `Run notify failed: ${role}`, result.reason || 'Unknown notify failure', 'warning', { related_work_item_id: item?.id || null, related_run_id: run?.id || null });
    setStatus(`Run queued, but notify failed: ${escapeHtml(result.reason || 'unknown error')}`, true);
    closePromptModal();
    await boot();
    return;
  }

  setStatus(`<span class="dot"></span> Run request queued for ${escapeHtml(role)} (notified #${notifyChannel})`);
  closePromptModal();
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
  openPromptModal({ ...item, owner_role: role, reviewer_role: el('task-reviewer-role')?.value || null }, role);
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
    const items = visibleItems.filter(w => w.status === status).sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
    const col = document.createElement("div");
    col.className = "column";
    col.dataset.status = status;
    col.innerHTML = `<h3>${label} (${items.length})</h3><div class="task-list"></div>`;
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
        div.className = "task-card";
        div.draggable = true;
        div.dataset.taskId = item.id;
        div.innerHTML = `
          <div class="title">${escapeHtml(item.title)}</div>
          <div class="small">${escapeHtml(item.description || '')}</div>
          <div class="badges">
            <span class="badge">${escapeHtml(item.domain)}</span>
            <span class="badge priority-${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span>
            ${item.owner_role ? `<span class="badge">${escapeHtml(item.owner_role)}</span>` : ''}
            ${item.external_facing ? `<span class="badge external">external-facing</span>` : ''}
            ${item.requires_security_review ? `<span class="badge review">security review</span>` : ''}
          </div>
          <div class="small" style="margin-top:10px;">Updated ${escapeHtml(fmtDate(item.updated_at || item.created_at))}</div>
          <div class="task-card-actions">
            <button class="mini-btn" data-action="assign">Assign</button>
            <button class="mini-btn" data-action="prompt">Prompt</button>
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
          if (action === 'assign') { event.stopPropagation(); openTaskModal(item); setTimeout(() => assignTaskToSuggestedAgent(), 0); return; }
          if (action === 'prompt') { event.stopPropagation(); openPromptModal(item); return; }
          openTaskModal(item);
        });
        list.appendChild(div);
      });
    }
    board.appendChild(col);
  });
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
        <thead><tr><th>Title</th><th>Type</th><th>Approval</th><th>Work item</th><th>Run</th><th>Path / URL</th><th>Created</th></tr></thead>
        <tbody>${state.artifacts.map(a => {
          const workItem = state.workItems.find(w => w.id === a.work_item_id);
          const run = state.runs.find(r => r.id === a.run_id);
          return `
          <tr class="artifact-row" data-artifact-id="${a.id}">
            <td>${escapeHtml(a.title)}</td>
            <td>${escapeHtml(a.artifact_type)}</td>
            <td>${escapeHtml(a.approval_status)}</td>
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

function renderIntegrations() {
  const summary = el('integration-summary');
  const discordStatus = state.integrationStatus?.discord || {};
  const discordWebhookCount = ['ops-log', 'kanban-updates'].filter(name => discordStatus[name]).length;
  if (summary) {
    summary.innerHTML = `
      <div class="card"><div class="metric">${state.channelRoutes.length}</div><div class="metric-label">Channel routes</div></div>
      <div class="card"><div class="metric">${state.channelRoutes.filter(r => r.active).length}</div><div class="metric-label">Active routes</div></div>
      <div class="card"><div class="metric">1</div><div class="metric-label">Supabase project</div></div>
      <div class="card"><div class="metric">${discordWebhookCount}</div><div class="metric-label">Webhook channels wired for audit posts</div></div>`;
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
  renderArtifacts();
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
}

function openTaskModal(item = null) {
  resetTaskForm();
  if (item) {
    taskModalState.editingId = item.id;
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
  }
  el('task-modal').classList.remove('hidden');
}

function closeTaskModal() { el('task-modal').classList.add('hidden'); }

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
  if (!payload.title) return alert('Task title is required.');

  let item = null;
  if (taskModalState.editingId) {
    const { data, error } = await supabaseClient.from('work_items').update(payload).eq('id', taskModalState.editingId).select().single();
    if (error) return alert(`Failed to update task: ${error.message}`);
    item = data;
    await announceTaskChange('task_updated', item, {
      title: `Task updated: ${payload.title}`,
      body: `Status: ${payload.status} • Priority: ${payload.priority}`,
      runSummary: `Updated work item: ${payload.title}`,
      runDetail: payload.description || 'Task updated from dashboard modal.',
      outputSummary: `Status set to ${payload.status}`,
      kanbanTitle: `Kanban update: ${payload.title}`,
      kanbanBody: `${payload.status} • ${payload.priority}`
    }, 'info');
  } else {
    const { data, error } = await supabaseClient.from('work_items').insert(payload).select().single();
    if (error) return alert(`Failed to create task: ${error.message}`);
    item = data;
    await announceTaskChange('task_created', item, {
      title: `Task created: ${payload.title}`,
      body: `Domain: ${payload.domain} • Priority: ${payload.priority}`,
      runSummary: `Created work item: ${payload.title}`,
      runDetail: payload.description || 'Task created from dashboard modal.',
      outputSummary: `Initial status ${payload.status}`,
      kanbanTitle: `Kanban new item: ${payload.title}`,
      kanbanBody: `${payload.domain} • ${payload.status}`
    }, 'success');
  }
  closeTaskModal();
  await boot();
}

async function deleteTask() {
  if (!taskModalState.editingId) return;
  const item = state.workItems.find(w => w.id === taskModalState.editingId);
  if (!confirm('Delete this task?')) return;
  const { error } = await supabaseClient.from('work_items').delete().eq('id', taskModalState.editingId);
  if (error) return alert(`Failed to delete task: ${error.message}`);
  await announceTaskChange('task_deleted', item, {
    title: `Task deleted: ${item?.title || 'Untitled task'}`,
    body: 'Task removed from dashboard kanban.',
    runSummary: `Deleted work item: ${item?.title || 'Untitled task'}`,
    runDetail: item?.description || 'Task deleted from dashboard modal.',
    outputSummary: 'Task removed from work_items.',
    kanbanTitle: `Kanban deleted: ${item?.title || 'Untitled task'}`,
    kanbanBody: 'Removed from board.'
  }, 'warning');
  closeTaskModal();
  await boot();
}

async function moveTaskToStatus(taskId, nextStatus) {
  const item = state.workItems.find(w => w.id === taskId);
  if (!item || item.status === nextStatus) return;
  const { data, error } = await supabaseClient.from('work_items').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', taskId).select().single();
  if (error) return alert(`Failed to move task: ${error.message}`);
  await announceTaskChange('task_moved', data, {
    title: `Task moved: ${item.title}`,
    body: `${item.status} → ${nextStatus}`,
    runSummary: `Moved work item: ${item.title}`,
    runDetail: `Status changed from ${item.status} to ${nextStatus} via dashboard drag-and-drop.`,
    outputSummary: `${item.status} → ${nextStatus}`,
    kanbanTitle: `Kanban moved: ${item.title}`,
    kanbanBody: `${statusLabel(item.status)} → ${statusLabel(nextStatus)}`
  }, 'info');
  await boot();
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
  el('refresh-btn')?.addEventListener('click', () => {
    if (bootError) {
      setStatus(bootError, true);
      return;
    }
    boot();
  });
  el('new-task-btn')?.addEventListener('click', () => {
    if (bootError) {
      setStatus(bootError, true);
      return;
    }
    openTaskModal();
  });
  document.addEventListener('click', (event) => {
    if (event.target?.id === 'new-artifact-btn') openArtifactModal();
    if (event.target?.id === 'test-ops-log-btn') runDiscordTest('ops-log');
    if (event.target?.id === 'test-kanban-btn') runDiscordTest('kanban-updates');
  });
  el('task-modal-close')?.addEventListener('click', closeTaskModal);
  el('task-cancel-btn')?.addEventListener('click', closeTaskModal);
  el('task-save-btn')?.addEventListener('click', saveTask);
  el('task-delete-btn')?.addEventListener('click', deleteTask);
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