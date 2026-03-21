insert into public.agent_runs (
  role_label,
  runtime,
  model_used,
  task_summary,
  task_detail,
  status,
  source_surface,
  source_channel_id,
  initiated_by,
  output_path,
  output_summary,
  started_at,
  completed_at
)
values
(
  'exec/agents-orchestrator',
  'acp',
  'codex',
  'Defined SecOpsAI Discord routing and dashboard rollout plan',
  'Classified the organization structure, mapped Discord channels to role labels, and sequenced dashboard implementation priorities.',
  'completed',
  'webchat',
  '1484922078837870794',
  'Techris',
  'secopsai-org/orchestration-runbook.md',
  'Produced routing and implementation summary for the first dashboard wave.',
  now() - interval '8 hours',
  now() - interval '7 hours 50 minutes'
),
(
  'product/product-manager',
  'acp',
  'codex',
  'Scoped SecOpsAI Vision dashboard v1',
  'Defined must-have scope, out-of-scope boundaries, and launch metrics for a triage-first detections dashboard.',
  'completed',
  'discord',
  '1484922872014176387',
  'Techris',
  'secopsai-org/acp-fallback/task-packs/vision-dashboard-v1/outputs/01-product-product-manager.out.md',
  'Locked v1 scope around findings queue, evidence detail, filters, and analyst workflow states.',
  now() - interval '6 hours',
  now() - interval '5 hours 40 minutes'
),
(
  'platform/backend-architect',
  'acp',
  'codex',
  'Designed normalized event and finding schemas',
  'Specified normalized telemetry/event structures, finding schemas, API/query surfaces, and data lifecycle constraints.',
  'completed',
  'discord',
  '1484922435772874772',
  'Techris',
  'secopsai-org/acp-fallback/task-packs/vision-dashboard-v1/outputs/03-platform-backend-architect.out.md',
  'Defined the backend contract for findings, evidence, and analyst state transitions.',
  now() - interval '5 hours',
  now() - interval '4 hours 35 minutes'
),
(
  'security/security-engineer',
  'acp',
  'codex',
  'Defined external-claim guardrails for launch messaging',
  'Reviewed trust boundaries, approved claims, prohibited claims, and launch gates for the dashboard rollout.',
  'completed',
  'discord',
  '1484922716015562792',
  'Techris',
  'secopsai-org/acp-fallback/task-packs/vision-dashboard-v1/outputs/05-security-security-engineer.out.md',
  'Approved workflow-improvement language and blocked unsupported detection/prevention claims.',
  now() - interval '4 hours',
  now() - interval '3 hours 40 minutes'
),
(
  'product/ui-designer',
  'acp',
  'codex',
  'Prepared triage-first dashboard IA and panel layout',
  'Outlined queue view, detail view, evidence hierarchy, filters, and accessibility expectations for Vision dashboard v1.',
  'completed',
  'discord',
  '1484922979182969023',
  'Techris',
  'secopsai-org/acp-fallback/task-packs/vision-dashboard-v1/outputs/04-product-ui-designer.out.md',
  'Recommended a tri-pane analyst workflow emphasizing severity, confidence, and source attribution.',
  now() - interval '3 hours',
  now() - interval '2 hours 25 minutes'
),
(
  'revenue/content-creator',
  'acp',
  'codex',
  'Drafted launch-ready website messaging for Vision dashboard',
  'Produced headline, subhead, bullets, CTA, and claim-risk notes for website launch copy.',
  'completed',
  'discord',
  '1484923062422863963',
  'Techris',
  'secopsai-org/acp-fallback/task-packs/vision-dashboard-v1/outputs/06-revenue-content-creator.out.md',
  'Positioned the product as an analyst workflow and evidence review layer instead of an autonomous security platform.',
  now() - interval '2 hours',
  now() - interval '95 minutes'
),
(
  'platform/devops-automator',
  'acp',
  'codex',
  'Prepare localhost-only dashboard serving plan',
  'Need a lightweight local/VPS hosting path for secopsai-dashboard with safe exposure and easy operator access.',
  'running',
  'discord',
  '1484922629247733820',
  'Techris',
  null,
  null,
  now() - interval '25 minutes',
  null
),
(
  'support/support-responder',
  'acp',
  'codex',
  'Summarize support-ready explanation for SecOpsAI dashboard setup',
  'Translate current architecture into a support-facing explanation and setup checklist for future reuse.',
  'queued',
  'discord',
  '1484923272243183626',
  'Techris',
  null,
  null,
  null,
  null
);

insert into public.work_items (
  title,
  description,
  domain,
  owner_role,
  reviewer_role,
  priority,
  status,
  external_facing,
  requires_security_review,
  source_surface,
  source_channel_id,
  created_by,
  due_date
)
values
(
  'Finalize dashboard shell and live Supabase wiring',
  'Verify the new secopsai-dashboard shell loads live data across Mission Control, Agents, Tasks, Artifacts, and Integrations.',
  'exec',
  'exec/agents-orchestrator',
  'platform/devops-automator',
  'high',
  'in_progress',
  false,
  false,
  'webchat',
  '1484922078837870794',
  'Techris',
  current_date + 1
),
(
  'Create sample operational data for dashboard demo',
  'Seed realistic work items, events, runs, and artifacts so the dashboard is useful before live automation is wired.',
  'exec',
  'exec/agents-orchestrator',
  'product/product-manager',
  'high',
  'review',
  false,
  false,
  'webchat',
  '1484922078837870794',
  'Techris',
  current_date
),
(
  'Implement dashboard hosting plan',
  'Serve secopsai-dashboard from a safe local-only endpoint or lightweight host path for regular access.',
  'platform',
  'platform/devops-automator',
  'platform/software-architect',
  'urgent',
  'planned',
  false,
  false,
  'discord',
  '1484922629247733820',
  'Techris',
  current_date + 2
),
(
  'Add create/edit workflow for work_items',
  'Upgrade the Tasks page from read-first kanban into a basic write-capable board with create and status update support.',
  'product',
  'product/product-manager',
  'platform/backend-architect',
  'high',
  'inbox',
  false,
  false,
  'discord',
  '1484922872014176387',
  'Techris',
  current_date + 3
),
(
  'Add security review badge handling to external-facing work',
  'Ensure all outward-facing artifacts and work items are visible and reviewable through the dashboard.',
  'security',
  'security/security-engineer',
  'product/product-manager',
  'high',
  'planned',
  true,
  true,
  'discord',
  '1484922716015562792',
  'Techris',
  current_date + 2
),
(
  'Prepare Vision dashboard PRD artifact package',
  'Turn the merged v1 package into durable artifacts linked from the dashboard.',
  'product',
  'product/product-manager',
  'security/security-engineer',
  'normal',
  'review',
  true,
  true,
  'discord',
  '1484922872014176387',
  'Techris',
  current_date + 1
),
(
  'Map Discord event posting for ops-log and kanban-updates',
  'Define which run and task events should be mirrored to Discord and at what verbosity.',
  'exec',
  'exec/agents-orchestrator',
  'support/support-responder',
  'normal',
  'in_progress',
  false,
  false,
  'discord',
  '1484976019831001189',
  'Techris',
  current_date + 1
),
(
  'Draft artifact browser improvements',
  'Design next-pass filters and approval-state views for the Artifacts page.',
  'product',
  'product/ui-designer',
  'product/product-manager',
  'low',
  'inbox',
  false,
  false,
  'discord',
  '1484922979182969023',
  'Techris',
  current_date + 5
),
(
  'Instrument agent run logging from orchestrated workflows',
  'Move from static seed data to automatic agent_runs inserts after each role task execution.',
  'platform',
  'platform/backend-architect',
  'exec/agents-orchestrator',
  'urgent',
  'blocked',
  false,
  false,
  'discord',
  '1484922435772874772',
  'Techris',
  current_date + 4
),
(
  'Review public launch copy against security guardrails',
  'Check website messaging against approved and prohibited claim patterns before publication.',
  'revenue',
  'revenue/content-creator',
  'security/security-engineer',
  'high',
  'done',
  true,
  true,
  'discord',
  '1484923062422863963',
  'Techris',
  current_date
);

insert into public.artifacts (
  artifact_type,
  title,
  path_or_url,
  summary,
  approved_by_role,
  approval_status
)
values
(
  'spec',
  'SecOpsAI Vision Dashboard v1 Merged Package',
  'secopsai-org/acp-fallback/task-packs/vision-dashboard-v1/outputs/merged-v1-package.md',
  'Merged product, backend, security, UX, and content outputs for Vision dashboard v1.',
  'product/product-manager',
  'review'
),
(
  'schema',
  'SecOpsAI Supabase Operational Schema',
  'secopsai-supabase-schema.sql',
  'Prototype-safe schema covering agent runs, work items, artifacts, dashboard events, and channel routing.',
  'platform/backend-architect',
  'approved'
),
(
  'spec',
  'SecOpsAI Dashboard Starter Shell',
  'secopsai-dashboard/index.html',
  'Initial dashboard shell with Mission Control, Agents, Tasks, Artifacts, and Integrations pages.',
  'product/ui-designer',
  'draft'
),
(
  'copy',
  'Vision Dashboard Website Messaging Draft',
  'secopsai-org/acp-fallback/task-packs/vision-dashboard-v1/outputs/06-revenue-content-creator.out.md',
  'Launch-ready website messaging draft pending final product and security sign-off.',
  'security/security-engineer',
  'review'
);

insert into public.dashboard_events (
  event_type,
  title,
  body,
  severity
)
values
(
  'schema_setup',
  'Supabase operational schema initialized',
  'Core SecOpsAI tables and Discord channel route mappings were created successfully.',
  'success'
),
(
  'dashboard',
  'Starter dashboard shell created',
  'Mission Control, Agents, Tasks, Artifacts, and Integrations pages are now present in secopsai-dashboard/.',
  'success'
),
(
  'routing',
  'Discord role routing loaded',
  'Channel mappings for orchestrator, platform, security, product, revenue, support, ops-log, and kanban-updates are available in channel_routes.',
  'success'
),
(
  'review',
  'External-facing work requires security sign-off',
  'Launch copy and any dashboard messaging must stay within approved claims and prohibited-claims guardrails.',
  'warning'
),
(
  'blocker',
  'Automatic agent run logging not wired yet',
  'The dashboard currently uses seed data; production-quality run logging still needs implementation.',
  'warning'
),
(
  'next_step',
  'Next milestone: interactive task management',
  'Add create/edit/status-update flows to the Tasks page and begin replacing seeds with live operational data.',
  'info'
);