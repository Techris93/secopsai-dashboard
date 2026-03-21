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

const state = {
  runs: [],
  workItems: [],
  artifacts: [],
  channelRoutes: [],
  events: []
};

const taskModalState = { editingId: null };
const dragState = { taskId: null };
const pages = ["mission-control", "agents", "tasks", "artifacts", "integrations"];

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

function getTaskFilters() {
  return {
    search: (el('task-search')?.value || '').trim().toLowerCase(),
    domain: el('task-filter-domain')?.value || '',
    priority: el('task-filter-priority')?.value || '',
    owner: (el('task-filter-owner')?.value || '').trim().toLowerCase()
  };
}

function filteredWorkItems() {
  const filters = getTaskFilters();
  return state.workItems.filter(item => {
    if (filters.domain && item.domain !== filters.domain) return false;
    if (filters.priority && item.priority !== filters.priority) return false;
    if (filters.owner && !(item.owner_role || '').toLowerCase().includes(filters.owner)) return false;
    if (filters.search) {
      const hay = `${item.title || ''} ${item.description || ''} ${item.owner_role || ''} ${item.reviewer_role || ''}`.toLowerCase();
      if (!hay.includes(filters.search)) return false;
    }
    return true;
  });
}

function renderMissionControl() {
  const activeRuns = state.runs.filter(r => ["queued", "running"].includes(r.status)).length;
  const blocked = state.workItems.filter(w => w.status === "blocked").length;
  const inReview = state.workItems.filter(w => w.status === "review").length;
  const doneToday = state.workItems.filter(w => {
    if (w.status !== "done" || !w.updated_at) return false;
    const d = new Date(w.updated_at);
    return d.toDateString() === new Date().toDateString();
  }).length;
  const secReview = state.workItems.filter(w => w.requires_security_review).length;

  const missionStats = el("mission-stats");
  if (missionStats) {
    missionStats.innerHTML = `
      <div class="card"><div class="metric">${activeRuns}</div><div class="metric-label">Active runs</div></div>
      <div class="card"><div class="metric">${blocked}</div><div class="metric-label">Blocked items</div></div>
      <div class="card"><div class="metric">${inReview}</div><div class="metric-label">In review</div></div>
      <div class="card"><div class="metric">${doneToday}</div><div class="metric-label">Done today</div></div>
      <div class="card"><div class="metric">${secReview}</div><div class="metric-label">Needs security review</div></div>
    `;
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
      <div class="card">
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

function renderAgents() {
  const latest = latestRunByRole(state.runs);
  const groups = cfg.roleGroups;
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
      card.style.borderColor = `${cfg.departments[dept] || '#06b6d4'}33`;
      card.innerHTML = `
        <div class="role">${escapeHtml(role)}</div>
        <div class="dept">${escapeHtml(dept)}</div>
        <div class="mini">
          <div><span>Last task:</span> ${escapeHtml(run?.task_summary || 'No data yet')}</div>
          <div><span>Status:</span> ${escapeHtml(run?.status || 'N/A')}</div>
          <div><span>Runtime:</span> ${escapeHtml(run?.runtime || 'N/A')}</div>
          <div><span>Model:</span> ${escapeHtml(run?.model_used || 'N/A')}</div>
          <div><span>Last active:</span> ${escapeHtml(run?.created_at ? fmtDate(run.created_at) : 'N/A')}</div>
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
        div.addEventListener('click', () => { if (!dragState.taskId) openTaskModal(item); });
        list.appendChild(div);
      });
    }
    board.appendChild(col);
  });
}

function renderArtifacts() {
  const host = el("artifacts-table");
  if (!host) return;
  if (!state.artifacts.length) {
    host.innerHTML = `<div class="empty">No artifacts yet.</div>`;
    return;
  }
  host.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Title</th><th>Type</th><th>Approval</th><th>Path / URL</th><th>Created</th></tr></thead>
        <tbody>${state.artifacts.map(a => `
          <tr>
            <td>${escapeHtml(a.title)}</td>
            <td>${escapeHtml(a.artifact_type)}</td>
            <td>${escapeHtml(a.approval_status)}</td>
            <td>${escapeHtml(a.path_or_url)}</td>
            <td>${escapeHtml(fmtDate(a.created_at))}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderIntegrations() {
  const summary = el('integration-summary');
  if (summary) {
    summary.innerHTML = `
      <div class="card"><div class="metric">${state.channelRoutes.length}</div><div class="metric-label">Discord routes</div></div>
      <div class="card"><div class="metric">${state.channelRoutes.filter(r => r.active).length}</div><div class="metric-label">Active routes</div></div>
      <div class="card"><div class="metric">1</div><div class="metric-label">Supabase project</div></div>
      <div class="card"><div class="metric">${cfg.serverId ? '1' : '0'}</div><div class="metric-label">Discord servers mapped</div></div>`;
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
        <h3>Discord</h3>
        <div class="kv-list">
          <div class="kv-row"><div class="kv-key">Server ID</div><div class="kv-val">${escapeHtml(cfg.serverId)}</div></div>
          <div class="kv-row"><div class="kv-key">Mapped channels</div><div class="kv-val">${state.channelRoutes.length}</div></div>
          <div class="kv-row"><div class="kv-key">Active mappings</div><div class="kv-val">${state.channelRoutes.filter(r => r.active).length}</div></div>
        </div>
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
      <thead><tr><th>Channel</th><th>Channel ID</th><th>Default role</th><th>Override</th><th>Summaries</th><th>Run logs</th><th>Active</th></tr></thead>
      <tbody>${state.channelRoutes.map(r => `
        <tr>
          <td>${escapeHtml(r.channel_name)}</td>
          <td>${escapeHtml(r.channel_id)}</td>
          <td>${escapeHtml(r.default_role_label)}</td>
          <td>${r.allow_orchestrator_override ? 'Yes' : 'No'}</td>
          <td>${r.post_summaries ? 'Yes' : 'No'}</td>
          <td>${r.post_run_logs ? 'Yes' : 'No'}</td>
          <td>${r.active ? 'Yes' : 'No'}</td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}

function renderAll() {
  renderMissionControl();
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

async function createDashboardEvent(event_type, title, body, severity = 'info') {
  const { error } = await supabaseClient.from('dashboard_events').insert({ event_type, title, body, severity });
  if (error) console.error('dashboard_events insert failed', error);
}

async function logAgentRun({ role_label, runtime = 'dashboard', model_used = 'n/a', task_summary, task_detail = null, status = 'completed', source_surface = 'dashboard', source_channel_id = null, initiated_by = 'Techris', output_path = null, output_summary = null }) {
  const now = new Date().toISOString();
  const payload = { role_label, runtime, model_used, task_summary, task_detail, status, source_surface, source_channel_id, initiated_by, output_path, output_summary, started_at: now, completed_at: status === 'completed' ? now : null };
  const { error } = await supabaseClient.from('agent_runs').insert(payload);
  if (error) console.error('agent_runs insert failed', error);
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

  if (taskModalState.editingId) {
    const { error } = await supabaseClient.from('work_items').update(payload).eq('id', taskModalState.editingId);
    if (error) return alert(`Failed to update task: ${error.message}`);
    await createDashboardEvent('task_updated', `Task updated: ${payload.title}`, `Status: ${payload.status} • Priority: ${payload.priority}`, 'info');
    await logAgentRun({ role_label: 'exec/agents-orchestrator', task_summary: `Updated work item: ${payload.title}`, task_detail: payload.description || 'Task updated from dashboard modal.', output_summary: `Status set to ${payload.status}` });
  } else {
    const { error } = await supabaseClient.from('work_items').insert(payload);
    if (error) return alert(`Failed to create task: ${error.message}`);
    await createDashboardEvent('task_created', `Task created: ${payload.title}`, `Domain: ${payload.domain} • Priority: ${payload.priority}`, 'success');
    await logAgentRun({ role_label: 'exec/agents-orchestrator', task_summary: `Created work item: ${payload.title}`, task_detail: payload.description || 'Task created from dashboard modal.', output_summary: `Initial status ${payload.status}` });
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
  await createDashboardEvent('task_deleted', `Task deleted: ${item?.title || 'Untitled task'}`, 'Task removed from dashboard kanban.', 'warning');
  await logAgentRun({ role_label: 'exec/agents-orchestrator', task_summary: `Deleted work item: ${item?.title || 'Untitled task'}`, task_detail: item?.description || 'Task deleted from dashboard modal.', output_summary: 'Task removed from work_items.' });
  closeTaskModal();
  await boot();
}

async function moveTaskToStatus(taskId, nextStatus) {
  const item = state.workItems.find(w => w.id === taskId);
  if (!item || item.status === nextStatus) return;
  const { error } = await supabaseClient.from('work_items').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', taskId);
  if (error) return alert(`Failed to move task: ${error.message}`);
  await createDashboardEvent('task_moved', `Task moved: ${item.title}`, `${item.status} → ${nextStatus}`, 'info');
  await logAgentRun({ role_label: 'exec/agents-orchestrator', task_summary: `Moved work item: ${item.title}`, task_detail: `Status changed from ${item.status} to ${nextStatus} via dashboard drag-and-drop.`, output_summary: `${item.status} → ${nextStatus}` });
  await boot();
}

async function boot() {
  try {
    state.channelRoutes = await loadTable('channel_routes', { orderBy: { column: 'channel_name', ascending: true } });
    state.runs = await loadTable('agent_runs', { orderBy: { column: 'created_at', ascending: false }, limit: 200 });
    state.workItems = await loadTable('work_items', { orderBy: { column: 'updated_at', ascending: false }, limit: 200 });
    state.artifacts = await loadTable('artifacts', { orderBy: { column: 'created_at', ascending: false }, limit: 200 });
    state.events = await loadTable('dashboard_events', { orderBy: { column: 'created_at', ascending: false }, limit: 100 });
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
  el('task-modal-close')?.addEventListener('click', closeTaskModal);
  el('task-cancel-btn')?.addEventListener('click', closeTaskModal);
  el('task-save-btn')?.addEventListener('click', saveTask);
  el('task-delete-btn')?.addEventListener('click', deleteTask);
  ['task-search', 'task-filter-domain', 'task-filter-priority', 'task-filter-owner'].forEach(id => {
    el(id)?.addEventListener('input', renderTasks);
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