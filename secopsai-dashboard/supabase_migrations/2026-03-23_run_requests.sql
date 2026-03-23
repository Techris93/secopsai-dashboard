-- Run Requests queue for dashboard-triggered executions
-- Apply in Supabase SQL editor (or your migration system).
-- Requires pgcrypto for gen_random_uuid().

create extension if not exists pgcrypto;

create table if not exists public.run_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),

  role_label text not null,
  prompt_text text not null,

  -- Optional hints
  suggested_channel_name text null,

  -- Linkages
  related_work_item_id uuid null,
  related_run_id uuid null,

  initiated_by text null,

  -- Results
  output_summary text null,
  output_path text null,
  error text null
);

create index if not exists run_requests_status_created_at_idx on public.run_requests (status, created_at desc);
create index if not exists run_requests_role_label_created_at_idx on public.run_requests (role_label, created_at desc);

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_run_requests_updated_at on public.run_requests;
create trigger set_run_requests_updated_at
before update on public.run_requests
for each row execute function public.set_updated_at();
