-- Findings table for SecOpsAI dashboard
-- Stores security findings from OpenClaw, macOS, Linux, Windows, and correlated detections
-- Apply in Supabase SQL editor (or your migration system).
-- Requires pgcrypto for gen_random_uuid().

create extension if not exists pgcrypto;

-- Findings table

create table if not exists public.findings (
    -- Primary identification
    id uuid primary key default gen_random_uuid(),
    external_finding_id text unique not null,  -- SecOpsAI finding ID (e.g., OCF-XXXX, SCX-XXXX)
    
    -- Source attribution (crucial for multi-source analysis)
    source text not null check (source in ('openclaw', 'macos', 'linux', 'windows', 'correlated')),
    source_platform text not null check (source_platform in ('openclaw', 'macos', 'linux', 'windows')),
    correlation_type text null check (correlation_type in (
        'cross_platform_ip', 
        'cross_platform_user', 
        'cross_platform_file',
        'time_cluster',
        'auth_compromise_then_abuse',
        'potential_exfiltration',
        'persistence_then_config_change',
        'defense_evasion',
        'suspicious_execution_then_burst',
        'credential_harvest_and_use'
    )),
    detection_layer text not null default 'host' check (detection_layer in ('application', 'host', 'correlated')),
    
    -- Finding content
    title text not null,
    summary text not null,
    severity text not null check (severity in ('info', 'low', 'medium', 'high', 'critical')),
    severity_score integer not null check (severity_score between 0 and 100),
    confidence text not null check (confidence in ('low', 'medium', 'high')),
    
    -- Status and disposition
    status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
    disposition text not null default 'unreviewed' check (disposition in ('unreviewed', 'true_positive', 'false_positive', 'benign', 'malicious')),
    
    -- Detection context
    rule_id text not null,
    rule_name text not null,
    source_name text null,  -- Human-readable source name (filename, etc.)
    detector text null,  -- Detector/rule name for display
    fingerprint text null,  -- Unique fingerprint for deduplication
    dedupe_key text null,  -- Key used for deduplication
    mitre text null,  -- Primary MITRE ATT&CK technique
    mitre_ids text[] null,  -- All applicable MITRE techniques
    
    -- Temporal tracking
    detected_at timestamptz not null,
    first_seen_at timestamptz not null,
    last_seen_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    resolved_at timestamptz null,
    
    -- Event linkage
    event_count integer not null default 1,
    event_ids text[] not null,
    
    -- Actor information
    actor_user text null,
    actor_process text null,
    actor_ip text null,
    actor_host text null,
    
    -- Target information
    target_user text null,
    target_resource text null,
    target_resource_type text null,
    target_path text null,
    
    -- Affected entities (for display)
    affected_users text[] null,
    affected_processes text[] null,
    affected_hosts text[] null,
    
    -- Risk categorization
    risk_tags text[] null,  -- e.g., ['persistence', 'execution', 'auth']
    persistence_category text null,  -- e.g., 'launchagent', 'cron'
    execution_category text null,  -- e.g., 'shell_inline', 'temp_directory'
    
    -- Evidence and context
    evidence text[] null,  -- Evidence lines
    recommended_actions text[] null,
    raw_payload jsonb null,  -- Full finding data
    
    -- Analyst workflow
    assigned_to text null,
    analyst_notes text null,
    
    -- Correlation linkage
    correlated_finding_ids text[] null,  -- IDs of related findings
    parent_finding_id text null,  -- For grouped/clustered findings
    
    -- Dashboard integration
    work_item_id uuid null references public.work_items(id) on delete set null,
    run_id uuid null references public.agent_runs(id) on delete set null,
    
    -- Metadata
    metadata jsonb null  -- Flexible additional data
);

-- Indexes for common queries

-- Primary lookups
 create index if not exists idx_findings_external_id on public.findings(external_finding_id);
create index if not exists idx_findings_source on public.findings(source);
create index if not exists idx_findings_source_platform on public.findings(source_platform);

-- Status and severity (for triage views)
create index if not exists idx_findings_status on public.findings(status);
create index if not exists idx_findings_severity on public.findings(severity);
create index if not exists idx_findings_disposition on public.findings(disposition);

-- Temporal queries (for timeline views)
create index if not exists idx_findings_detected_at on public.findings(detected_at desc);
create index if not exists idx_findings_created_at on public.findings(created_at desc);
create index if not exists idx_findings_first_seen_at on public.findings(first_seen_at desc);

-- Rule-based queries
create index if not exists idx_findings_rule_id on public.findings(rule_id);
create index if not exists idx_findings_mitre on public.findings(mitre);

-- Entity-based queries (for user/process investigation)
create index if not exists idx_findings_actor_user on public.findings(actor_user);
create index if not exists idx_findings_actor_host on public.findings(actor_host);
create index if not exists idx_findings_target_user on public.findings(target_user);

-- Correlation queries
create index if not exists idx_findings_correlation_type on public.findings(correlation_type);
create index if not exists idx_findings_detection_layer on public.findings(detection_layer);

-- Full-text search (on title and summary)
create index if not exists idx_findings_search on public.findings 
    using gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '')));

-- Risk tag queries (GIN for array containment)
create index if not exists idx_findings_risk_tags on public.findings using gin(risk_tags);

-- Work item linkage
create index if not exists idx_findings_work_item_id on public.findings(work_item_id);

-- Composite indexes for common filters
create index if not exists idx_findings_source_severity on public.findings(source, severity);
create index if not exists idx_findings_platform_detected on public.findings(source_platform, detected_at desc);
create index if not exists idx_findings_status_severity on public.findings(status, severity);

-- Row Level Security (RLS)

alter table public.findings enable row level security;

-- Read policy (allow all for now - adjust based on your security model)
drop policy if exists "allow read findings" on public.findings;
create policy "allow read findings" on public.findings for select using (true);

-- Write policy (allow all for now - adjust based on your security model)
drop policy if exists "allow write findings" on public.findings;
create policy "allow write findings" on public.findings for all using (true) with check (true);

-- Trigger to auto-update updated_at

create or replace function public.set_findings_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists set_findings_updated_at on public.findings;
create trigger set_findings_updated_at
    before update on public.findings
    for each row execute function public.set_findings_updated_at();

-- View for high-priority findings (dashboard widget)

create or replace view public.high_priority_findings as
select 
    id,
    external_finding_id,
    source,
    source_platform,
    severity,
    severity_score,
    confidence,
    title,
    summary,
    actor_user,
    actor_host,
    detected_at,
    event_count,
    risk_tags,
    disposition,
    assigned_to
from public.findings
where status = 'open'
  and severity in ('high', 'critical')
order by severity_score desc, detected_at desc;

-- View for correlated findings (attack chain analysis)

create or replace view public.correlated_findings as
select 
    id,
    external_finding_id,
    source,
    correlation_type,
    detection_layer,
    severity,
    confidence,
    title,
    detected_at,
    actor_user,
    target_resource,
    correlated_finding_ids,
    work_item_id
from public.findings
where correlation_type is not null
order by detected_at desc;

-- View for findings by source (operational metrics)

create or replace view public.findings_by_source as
select 
    date_trunc('day', detected_at) as detection_date,
    source,
    source_platform,
    severity,
    count(*) as finding_count,
    avg(severity_score) as avg_severity_score,
    count(distinct actor_user) as unique_users_affected,
    count(distinct actor_host) as unique_hosts_affected
from public.findings
group by 1, 2, 3, 4
order by detection_date desc, finding_count desc;

-- Materialized view for MITRE technique frequency (refresh periodically)

create materialized view if not exists public.mitre_technique_frequency as
select 
    mitre as technique_id,
    count(*) as occurrence_count,
    count(distinct source) as source_count,
    array_agg(distinct source_platform) as seen_on_platforms,
    max(detected_at) as last_seen,
    min(detected_at) as first_seen
from public.findings
where mitre is not null
group by mitre
order by occurrence_count desc;

-- Function to link finding to work item (for triage workflow)

create or replace function public.link_finding_to_work_item(
    p_finding_id uuid,
    p_work_item_id uuid
)
returns void as $$
begin
    update public.findings
    set work_item_id = p_work_item_id,
        status = 'in_progress',
        updated_at = now()
    where id = p_finding_id;
end;
$$ language plpgsql;

-- Function to get findings timeline for a user

create or replace function public.get_user_findings_timeline(
    p_user text,
    p_days integer default 7
)
returns table (
    detected_at timestamptz,
    external_finding_id text,
    severity text,
    title text,
    source text
) as $$
begin
    return query
    select 
        f.detected_at,
        f.external_finding_id,
        f.severity,
        f.title,
        f.source
    from public.findings f
    where f.actor_user = p_user
      and f.detected_at >= now() - (p_days || ' days')::interval
    order by f.detected_at desc;
end;
$$ language plpgsql;

-- Comments for documentation

comment on table public.findings is 'Security findings from SecOpsAI detection engine across all platforms';
comment on column public.findings.source is 'Origin of the finding: openclaw, macos, linux, windows, or correlated';
comment on column public.findings.source_platform is 'Underlying platform: openclaw, macos, linux, windows';
comment on column public.findings.correlation_type is 'Type of cross-platform correlation, if applicable';
comment on column public.findings.detection_layer is 'Detection depth: application, host, or correlated multi-source';
comment on column public.findings.severity_score is 'Numeric severity 0-100 for sorting and prioritization';
comment on column public.findings.confidence is 'Detection confidence based on signal strength and context';
comment on column public.findings.risk_tags is 'Categorization tags: persistence, execution, auth, privacy, etc.';
