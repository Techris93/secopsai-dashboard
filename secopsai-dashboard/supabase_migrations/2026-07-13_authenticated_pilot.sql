-- SecOpsAI Mission Control authenticated single-tenant pilot boundary.
--
-- This migration removes anonymous table access and replaces existing dashboard
-- policies with authenticated-user policies. It is intentionally single-tenant:
-- every invited Supabase Auth user belongs to the same pilot workspace. Add
-- workspace_id and membership policies before inviting multiple customers.

do $$
declare
  table_name text;
  policy_record record;
  dashboard_tables text[] := array[
    'agent_runs',
    'channel_routes',
    'dashboard_events',
    'findings',
    'run_requests',
    'work_items'
  ];
begin
  foreach table_name in array dashboard_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise notice 'Skipping absent optional dashboard table public.%', table_name;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all privileges on table public.%I from anon', table_name);
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated',
      table_name
    );

    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = table_name
    loop
      execute format('drop policy %I on public.%I', policy_record.policyname, table_name);
    end loop;

    execute format(
      'create policy secopsai_authenticated_select on public.%I for select to authenticated using ((select auth.uid()) is not null and coalesce(((select auth.jwt()) ->> ''is_anonymous'')::boolean, false) = false)',
      table_name
    );
    execute format(
      'create policy secopsai_authenticated_insert on public.%I for insert to authenticated with check ((select auth.uid()) is not null and coalesce(((select auth.jwt()) ->> ''is_anonymous'')::boolean, false) = false)',
      table_name
    );
    execute format(
      'create policy secopsai_authenticated_update on public.%I for update to authenticated using ((select auth.uid()) is not null and coalesce(((select auth.jwt()) ->> ''is_anonymous'')::boolean, false) = false) with check ((select auth.uid()) is not null and coalesce(((select auth.jwt()) ->> ''is_anonymous'')::boolean, false) = false)',
      table_name
    );
    execute format(
      'create policy secopsai_authenticated_delete on public.%I for delete to authenticated using ((select auth.uid()) is not null and coalesce(((select auth.jwt()) ->> ''is_anonymous'')::boolean, false) = false)',
      table_name
    );
  end loop;
end
$$;

-- Views and materialized views are separate grant surfaces. Keep them invisible
-- to the anon role even when they were created before RLS was enabled.
do $$
declare
  relation_name text;
  dashboard_relations text[] := array[
    'high_priority_findings',
    'correlated_findings',
    'findings_by_source',
    'mitre_technique_frequency'
  ];
begin
  foreach relation_name in array dashboard_relations loop
    if to_regclass(format('public.%I', relation_name)) is not null then
      execute format('revoke all privileges on table public.%I from anon', relation_name);
      execute format('grant select on table public.%I to authenticated', relation_name);
      if (select relkind from pg_class where oid = to_regclass(format('public.%I', relation_name))) = 'v' then
        execute format('alter view public.%I set (security_invoker = true)', relation_name);
      end if;
    end if;
  end loop;
end
$$;

revoke execute on function public.link_finding_to_work_item(uuid, uuid) from public, anon;
revoke execute on function public.get_user_findings_timeline(text, integer) from public, anon;
grant execute on function public.link_finding_to_work_item(uuid, uuid) to authenticated;
grant execute on function public.get_user_findings_timeline(text, integer) to authenticated;
