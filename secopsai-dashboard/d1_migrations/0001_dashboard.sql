-- Mission Control data on Cloudflare D1 (replaces the Supabase tables).
-- Arrays and jsonb are stored as JSON text; booleans as 0/1.  The Worker's
-- data API (data-api.js) validates columns and converts types both ways.
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  run_group_id TEXT,
  role_label TEXT NOT NULL,
  runtime TEXT NOT NULL,
  model_used TEXT,
  task_summary TEXT NOT NULL,
  task_detail TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
  source_surface TEXT,
  source_channel_id TEXT,
  source_message_id TEXT,
  initiated_by TEXT,
  parent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  output_path TEXT,
  output_summary TEXT,
  error_summary TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_runs_created ON agent_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  domain TEXT NOT NULL CHECK (domain IN ('exec','platform','security','product','revenue','support')),
  owner_role TEXT,
  reviewer_role TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox','planned','in_progress','review','blocked','done')),
  external_facing INTEGER NOT NULL DEFAULT 0,
  requires_security_review INTEGER NOT NULL DEFAULT 0,
  source_surface TEXT,
  source_channel_id TEXT,
  source_message_id TEXT,
  linked_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  due_date TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS work_items_updated ON work_items (updated_at DESC);

CREATE TABLE IF NOT EXISTS channel_routes (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'discord',
  server_id TEXT NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  channel_name TEXT,
  default_role_label TEXT NOT NULL,
  allow_orchestrator_override INTEGER NOT NULL DEFAULT 1,
  post_summaries INTEGER NOT NULL DEFAULT 1,
  post_run_logs INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','error','success')),
  related_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  related_work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dashboard_events_created ON dashboard_events (created_at DESC);

CREATE TABLE IF NOT EXISTS run_requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  role_label TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  suggested_channel_name TEXT,
  related_work_item_id TEXT,
  related_run_id TEXT,
  initiated_by TEXT,
  output_summary TEXT,
  output_path TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS run_requests_created ON run_requests (created_at DESC);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  external_finding_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_platform TEXT NOT NULL,
  correlation_type TEXT,
  detection_layer TEXT NOT NULL DEFAULT 'host',
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  severity_score INTEGER NOT NULL CHECK (severity_score BETWEEN 0 AND 100),
  confidence TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  disposition TEXT NOT NULL DEFAULT 'unreviewed',
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  source_name TEXT,
  detector TEXT,
  fingerprint TEXT,
  dedupe_key TEXT,
  mitre TEXT,
  mitre_ids TEXT,
  detected_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  event_count INTEGER NOT NULL DEFAULT 1,
  event_ids TEXT NOT NULL DEFAULT '[]',
  actor_user TEXT,
  actor_process TEXT,
  actor_ip TEXT,
  actor_host TEXT,
  target_user TEXT,
  target_resource TEXT,
  target_resource_type TEXT,
  target_path TEXT,
  affected_users TEXT,
  affected_processes TEXT,
  affected_hosts TEXT,
  risk_tags TEXT,
  persistence_category TEXT,
  execution_category TEXT,
  evidence TEXT,
  recommended_actions TEXT,
  raw_payload TEXT,
  assigned_to TEXT,
  analyst_notes TEXT,
  correlated_finding_ids TEXT,
  parent_finding_id TEXT,
  work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  related_work_item_id TEXT,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS findings_last_seen ON findings (last_seen_at DESC);
