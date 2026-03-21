create extension if not exists pgcrypto;

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  run_group_id uuid null,
  role_label text not null,
  runtime text not null,
  model_used text null,
  task_summary text not null,
  task_detail text null,
  status text not null check (status in ('queued','running','completed','failed','cancelled')),
  source_surface text null,
  source_channel_id text null,
  source_message_id text null,
  initiated_by text null,
  parent_run_id uuid null references public.agent_runs(id) on delete set null,
  output_path text null,
  output_summary text null,
  error_summary text null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.work_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text null,
  domain text not null check (domain in ('exec','platform','security','product','revenue','support')),
  owner_role text null,
  reviewer_role text null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'inbox' check (status in ('inbox','planned','in_progress','review','blocked','done')),
  external_facing boolean not null default false,
  requires_security_review boolean not null default false,
  source_surface text null,
  source_channel_id text null,
  source_message_id text null,
  linked_run_id uuid null references public.agent_runs(id) on delete set null,
  due_date date null,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid null references public.work_items(id) on delete cascade,
  run_id uuid null references public.agent_runs(id) on delete set null,
  artifact_type text not null,
  title text not null,
  path_or_url text not null,
  summary text null,
  approved_by_role text null,
  approval_status text not null default 'draft' check (approval_status in ('draft','review','approved','rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.channel_routes (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'discord',
  server_id text not null,
  channel_id text not null unique,
  channel_name text null,
  default_role_label text not null,
  allow_orchestrator_override boolean not null default true,
  post_summaries boolean not null default true,
  post_run_logs boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.dashboard_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  title text not null,
  body text null,
  severity text not null default 'info' check (severity in ('info','warning','error','success')),
  related_run_id uuid null references public.agent_runs(id) on delete set null,
  related_work_item_id uuid null references public.work_items(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_runs_role_label on public.agent_runs(role_label);
create index if not exists idx_agent_runs_status on public.agent_runs(status);
create index if not exists idx_agent_runs_created_at on public.agent_runs(created_at desc);
create index if not exists idx_work_items_status on public.work_items(status);
create index if not exists idx_work_items_domain on public.work_items(domain);
create index if not exists idx_work_items_owner_role on public.work_items(owner_role);
create index if not exists idx_work_items_updated_at on public.work_items(updated_at desc);
create index if not exists idx_artifacts_work_item_id on public.artifacts(work_item_id);
create index if not exists idx_artifacts_run_id on public.artifacts(run_id);
create index if not exists idx_channel_routes_channel_id on public.channel_routes(channel_id);
create index if not exists idx_dashboard_events_created_at on public.dashboard_events(created_at desc);

alter table public.agent_runs enable row level security;
alter table public.work_items enable row level security;
alter table public.artifacts enable row level security;
alter table public.channel_routes enable row level security;
alter table public.dashboard_events enable row level security;

drop policy if exists "proto read agent_runs" on public.agent_runs;
drop policy if exists "proto write agent_runs" on public.agent_runs;
create policy "proto read agent_runs" on public.agent_runs for select using (true);
create policy "proto write agent_runs" on public.agent_runs for all using (true) with check (true);

drop policy if exists "proto read work_items" on public.work_items;
drop policy if exists "proto write work_items" on public.work_items;
create policy "proto read work_items" on public.work_items for select using (true);
create policy "proto write work_items" on public.work_items for all using (true) with check (true);

drop policy if exists "proto read artifacts" on public.artifacts;
drop policy if exists "proto write artifacts" on public.artifacts;
create policy "proto read artifacts" on public.artifacts for select using (true);
create policy "proto write artifacts" on public.artifacts for all using (true) with check (true);

drop policy if exists "proto read channel_routes" on public.channel_routes;
drop policy if exists "proto write channel_routes" on public.channel_routes;
create policy "proto read channel_routes" on public.channel_routes for select using (true);
create policy "proto write channel_routes" on public.channel_routes for all using (true) with check (true);

drop policy if exists "proto read dashboard_events" on public.dashboard_events;
drop policy if exists "proto write dashboard_events" on public.dashboard_events;
create policy "proto read dashboard_events" on public.dashboard_events for select using (true);
create policy "proto write dashboard_events" on public.dashboard_events for all using (true) with check (true);

insert into public.channel_routes (
  provider,
  server_id,
  channel_id,
  channel_name,
  default_role_label,
  allow_orchestrator_override,
  post_summaries,
  post_run_logs,
  active
)
values
('discord', '1484917962245668874', '1484922078837870794', 'orchestrator', 'exec/agents-orchestrator', true, true, false, true),
('discord', '1484917962245668874', '1484976019831001189', 'ops-log', 'exec/agents-orchestrator', false, true, true, true),
('discord', '1484917962245668874', '1484922346291855503', 'platform-architecture', 'platform/software-architect', true, true, false, true),
('discord', '1484917962245668874', '1484922435772874772', 'platform-backend', 'platform/backend-architect', true, true, false, true),
('discord', '1484917962245668874', '1484922552777314438', 'platform-ai', 'platform/ai-engineer', true, true, false, true),
('discord', '1484917962245668874', '1484922629247733820', 'platform-devops', 'platform/devops-automator', true, true, false, true),
('discord', '1484917962245668874', '1484922716015562792', 'security-engineering', 'security/security-engineer', true, true, false, true),
('discord', '1484917962245668874', '1484922806084042812', 'threat-detection', 'security/threat-detection-engineer', true, true, false, true),
('discord', '1484917962245668874', '1484922872014176387', 'product', 'product/product-manager', true, true, false, true),
('discord', '1484917962245668874', '1484922979182969023', 'ui-ux', 'product/ui-designer', true, true, false, true),
('discord', '1484917962245668874', '1484923062422863963', 'content', 'revenue/content-creator', true, true, false, true),
('discord', '1484917962245668874', '1484923133990404337', 'outbound', 'revenue/outbound-strategist', true, true, false, true),
('discord', '1484917962245668874', '1484923195013337261', 'sales-engineering', 'revenue/sales-engineer', true, true, false, true),
('discord', '1484917962245668874', '1484923272243183626', 'support-triage', 'support/support-responder', true, true, false, true),
('discord', '1484917962245668874', '1484923344573825128', 'kanban-updates', 'exec/agents-orchestrator', false, true, true, true);