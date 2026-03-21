const { createClient } = window.supabase;
const cfg = window.SECOPSAI_CONFIG;
const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

const state = {
  runs: [],
  workItems: [],
  artifacts: [],
  channelRoutes: [],
  events: []
};

const pages = ["mission-control", "agents", "tasks", "artifacts", "integrations"];

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

function setPage(pageId) {
  pages.forEach((id) => {
    document.getElementById(`page-${id}`).classList.toggle("active", id === pageId);
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

function renderMissionControl() {
  const activeRuns = state.runs.filter(r => ["queued", "running"].includes(r.status)).length;
  const blocked = state.workItems.filter(w => w.status === "blocked").length;
  const inReview = state.workItems.filter(w => w.status === "review").length;
  const doneToday = state.workItems.filter(w => {
    if (w.status !== "done" || !w.updated_at) return false;
    const d = new Date(w.updated_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;
  const secReview = state.workItems.filter(w => w.requires_security_review).length;

  document.getElementById("mission-stats").innerHTML = `
    <div class="card"><div class="metric">${activeRuns}</div><div class="metric-label">Active runs</div></div>
    <div class="card"><div class="metric">${blocked}</div><div class="metric-label">Blocked items</div></div>
    <div class="card"><div class="metric">${inReview}</div><div class="metric-label">In review</div></div>
    <div class="card"><div class="metric">${doneToday}</div><div class="metric-label">Done today</div></div>
    <div class="card"><div class="metric">${secReview}</div><div class="metric-label">Needs security review</div></div>
  `;

  const byDomain = state.workItems.reduce((acc, item) => {
    acc[item.domain] = (acc[item.domain] || 0) + 1;
    return acc;
  }, {});
  const topDomains = Object.entries(byDomain).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const extFacing = state.workItems.filter(w => w.external_facing).length;
  const approvedArtifacts = state.artifacts.filter(a => a.approval_status === 'approved').length;
  document.getElementById("mission-overview").innerHTML = `
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

  const recentFeed = [...state.events]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 6);

  const recentRuns = [...state.runs]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 6);

  document.getElementById("mission-events").innerHTML = recentFeed.length ? recentFeed.map(ev => `
    <div class="feed-item" style="border-left-color:${ev.severity === 'error' ? '#ef4444' : ev.severity === 'success' ? '#10b981' : '#06b6d4'}">
      <div><strong>${escapeHtml(ev.title)}</strong></div>
      <div class="small">${escapeHtml(ev.body || '')}</div>
      <div class="meta">${escapeHtml(ev.event_type)} • ${fmtDate(ev.created_at)}</div>
    </div>
  `).join("") : `<div class="empty">No dashboard events yet.</div>`;

  document.getElementById("mission-runs").innerHTML = recentRuns.length ? recentRuns.map(run => `
    <div class="feed-item" style="border-left-color:${cfg.departments[roleDepartment(run.role_label)] || '#06b6d4'}">
      <div><strong>${escapeHtml(run.role_label)}</strong> — ${escapeHtml(run.task_summary)}</div>
      <div class="meta">${escapeHtml(run.status)} • ${escapeHtml(run.runtime || '—')} • ${fmtDate(run.created_at)}</div>
    </div>
  `).join("") : `<div class="empty">No agent runs yet.</div>`;
}

function renderAgents() {
  const latest = latestRunByRole(state.runs);
  const groups = cfg.roleGroups;
  const host = document.getElementById("agents-groups");
  host.innerHTML = "";

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
  const statuses = [
    ["inbox", "Inbox"],
    ["planned", "Planned"],
    ["in_progress", "In Progress"],
    ["review", "Review"],
    ["blocked", "Blocked"],
    ["done", "Done"]
  ];
  const board = document.getElementById("task-board");
  board.innerHTML = "";

  statuses.forEach(([status, label]) => {
    const items = state.workItems
      .filter(w => w.status === status)
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

    const col = document.createElement("div");
    col.className = "column";
    col.innerHTML = `<h3>${label} (${items.length})</h3><div class="task-list"></div>`;
    const list = col.querySelector(".task-list");

    if (!items.length) {
      list.innerHTML = `<div class="empty">No items in ${label.toLowerCase()}.</div>`;
    } else {
      items.forEach(item => {
        const div = document.createElement("div");
        div.className = "task-card";
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
        list.appendChild(div);
      });
    }
    board.appendChild(col);
  });
}

function renderArtifacts() {
  const host = document.getElementById("artifacts-table");
  if (!state.artifacts.length) {
    host.innerHTML = `<div class="empty">No artifacts yet.</div>`;
    return;
  }
  host.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Title</th><th>Type</th><th>Approval</th><th>Path / URL</th><th>Created</th></tr>
        </thead>
        <tbody>
          ${state.artifacts.map(a => `
            <tr>
              <td>${escapeHtml(a.title)}</td>
              <td>${escapeHtml(a.artifact_type)}</td>
              <td>${escapeHtml(a.approval_status)}</td>
              <td>${escapeHtml(a.path_or_url)}</td>
              <td>${escapeHtml(fmtDate(a.created_at))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderIntegrations() {
  document.getElementById("integration-summary").innerHTML = `
    <div class="card"><div class="metric">${state.channelRoutes.length}</div><div class="metric-label">Discord routes</div></div>
    <div class="card"><div class="metric">${state.channelRoutes.filter(r => r.active).length}</div><div class="metric-label">Active routes</div></div>
    <div class="card"><div class="metric">1</div><div class="metric-label">Supabase project</div></div>
    <div class="card"><div class="metric">${cfg.serverId ? '1' : '0'}</div><div class="metric-label">Discord servers mapped</div></div>
  `;

  document.getElementById("integration-config").innerHTML = `
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
    </div>
  `;

  const table = document.getElementById("routes-table");
  if (!state.channelRoutes.length) {
    table.innerHTML = `<div class="empty">No channel routes found.</div>`;
    return;
  }

  table.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Channel</th>
            <th>Channel ID</th>
            <th>Default role</th>
            <th>Override</th>
            <th>Summaries</th>
            <th>Run logs</th>
            <th>Active</th>
          </tr>
        </thead>
        <tbody>
          ${state.channelRoutes.map(r => `
            <tr>
              <td>${escapeHtml(r.channel_name)}</td>
              <td>${escapeHtml(r.channel_id)}</td>
              <td>${escapeHtml(r.default_role_label)}</td>
              <td>${r.allow_orchestrator_override ? 'Yes' : 'No'}</td>
              <td>${r.post_summaries ? 'Yes' : 'No'}</td>
              <td>${r.post_run_logs ? 'Yes' : 'No'}</td>
              <td>${r.active ? 'Yes' : 'No'}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAll() {
  renderMissionControl();
  renderAgents();
  renderTasks();
  renderArtifacts();
  renderIntegrations();
  document.getElementById("global-status").innerHTML = `<span class="dot"></span> Supabase connected • ${state.channelRoutes.length} routes loaded`;
}

async function loadTable(table, options = {}) {
  let query = supabase.from(table).select(options.select || "*");
  if (options.orderBy) query = query.order(options.orderBy.column, { ascending: options.orderBy.ascending ?? false });
  if (options.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function boot() {
  try {
    state.channelRoutes = await loadTable("channel_routes", { orderBy: { column: "channel_name", ascending: true } });
    state.runs = await loadTable("agent_runs", { orderBy: { column: "created_at", ascending: false }, limit: 200 });
    state.workItems = await loadTable("work_items", { orderBy: { column: "updated_at", ascending: false }, limit: 200 });
    state.artifacts = await loadTable("artifacts", { orderBy: { column: "created_at", ascending: false }, limit: 200 });
    state.events = await loadTable("dashboard_events", { orderBy: { column: "created_at", ascending: false }, limit: 100 });
    renderAll();
  } catch (err) {
    console.error(err);
    document.getElementById("global-status").innerHTML = `<span class="error">Error loading Supabase data: ${escapeHtml(err.message || String(err))}</span>`;
  }
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => setPage(btn.dataset.page));
});

document.getElementById("refresh-btn").addEventListener("click", boot);

setPage("mission-control");
boot();
