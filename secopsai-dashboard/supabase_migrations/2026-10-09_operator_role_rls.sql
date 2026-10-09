-- SecOpsAI Mission Control: operator-only data access.
--
-- 2026-07-13_authenticated_pilot.sql granted every authenticated Supabase user
-- full access to the dashboard tables.  Email sign-up is enabled on the
-- project, so any self-registered account could read and modify findings,
-- work items, and run requests.  This migration narrows every policy to users
-- whose server-controlled app_metadata carries secopsai_role = operator/admin.
-- app_metadata can only be written with the service role; users cannot grant
-- it to themselves (unlike user_metadata).
--
-- BEFORE applying, grant the role to each real operator, for example:
--
--   update auth.users
--      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
--                              || '{"secopsai_role": "operator"}'::jsonb
--    where email = 'you@example.com';
--
-- Operators must sign out and back in afterwards so their JWT carries the
-- claim.  Also disable public sign-up: Authentication -> Providers -> Email ->
-- "Allow new users to sign up" = off (or `disable_signup = true`).

create or replace function public.secopsai_is_operator()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select auth.jwt()) -> 'app_metadata' ->> 'secopsai_role' in ('operator', 'admin'),
    false
  )
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false;
$$;

revoke all on function public.secopsai_is_operator() from public, anon;
grant execute on function public.secopsai_is_operator() to authenticated;

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

    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = table_name
    loop
      execute format('drop policy %I on public.%I', policy_record.policyname, table_name);
    end loop;

    execute format(
      'create policy secopsai_operator_select on public.%I for select to authenticated using ((select public.secopsai_is_operator()))',
      table_name
    );
    execute format(
      'create policy secopsai_operator_insert on public.%I for insert to authenticated with check ((select public.secopsai_is_operator()))',
      table_name
    );
    execute format(
      'create policy secopsai_operator_update on public.%I for update to authenticated using ((select public.secopsai_is_operator())) with check ((select public.secopsai_is_operator()))',
      table_name
    );
    execute format(
      'create policy secopsai_operator_delete on public.%I for delete to authenticated using ((select public.secopsai_is_operator()))',
      table_name
    );
  end loop;
end
$$;

-- Blog comments are written only by the blog Worker with the service role.
-- No browser role may read pending comments (they contain email addresses).
do $$
begin
  if to_regclass('public.blog_comments') is not null then
    alter table public.blog_comments enable row level security;
    revoke all privileges on table public.blog_comments from anon, authenticated;
  end if;
end
$$;
