import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const index = read('index.html');
const app = read('app.js');
const styles = read('styles.css');
const readmeTour = read('tests/fixtures/readme-product-tour.html');
const repositoryReadme = fs.readFileSync(path.resolve(root, '..', 'README.md'), 'utf8');

const allIds = [...index.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(allIds).size, allIds.length, 'every dashboard element id must be unique');
assert.equal((index.match(/id="task-filter-reviewer"/g) || []).length, 1, 'Work must expose one reviewer filter');

for (const match of index.matchAll(/<button\b([^>]*)>/gi)) {
  const attrs = match[1];
  const id = attrs.match(/\bid="([^"]+)"/)?.[1];
  if (!id) continue;
  const directlyReferenced = app.includes(`'${id}'`) || app.includes(`"${id}"`);
  const dataAttributes = [...attrs.matchAll(/\b(data-[a-z0-9-]+)=/gi)].map(item => item[1].toLowerCase());
  const delegated = dataAttributes.some(attribute => app.includes(`[${attribute}]`));
  assert.ok(directlyReferenced || delegated, `static button ${id} is not wired directly or through a data-action handler`);
}

assert.match(index, /professional-ui/);
for (const [page, route] of [
  ['mission-control', 'overview'],
  ['findings', 'findings'],
  ['edge', 'assets'],
  ['tasks', 'work'],
  ['research-cases', 'research\\/cases'],
  ['blog-ops', 'publications'],
  ['automation', 'automation'],
  ['integrations', 'system']
]) {
  assert.match(index, new RegExp(`data-page="${page}"`));
  assert.match(index, new RegExp(`data-route="${route}"`));
}

assert.match(app, /const PAGE_ROUTES/);
for (const marker of ['renderContextNav', 'currentPageFromLocation', 'openCommandPalette', 'openHelpDrawer']) {
  assert.match(app, new RegExp(`function ${marker}`));
}

for (const marker of ['toast-region', 'command-palette', 'help-drawer', 'confirm-dialog', 'professional-ui .app-shell', 'context-nav-btn']) {
  assert.ok((index + styles).includes(marker), `missing ${marker}`);
}
for (const route of ['research/inbox', 'research/cases', 'research/campaigns', 'research/watchlists', 'research/coverage', 'research/disclosure', 'research/sandbox', 'publications/research', 'publications/advisories', 'publications/news', 'publications/drafts', 'publications/review', 'publications/published', 'system/health', 'system/integrations', 'system/credentials', 'system/audit', 'assets/inventory', 'assets/changes', 'assets/sensors', 'assets/schedules', 'assets/wifi']) {
  assert.match(app, new RegExp(route.replace('/', '\\/')));
}
for (const marker of ['research-view-summary', 'publication-view-summary', 'automation-view-summary', 'system-view-summary', 'asset-view-summary', 'mission-research-queues', 'research-inbox-candidates', 'research-disclosure-queue', 'research-sandbox-queue', 'data-research-section="watchlists"', 'data-research-section="campaigns"', 'data-research-section="cases"', 'data-blog-section="news"', 'data-edge-section="sensors"', 'research-stage-stepper', 'mobile-card-table', 'metric-scope']) {
  assert.ok((index + styles + app).includes(marker), `missing redesign contract: ${marker}`);
}
for (const marker of ['mission-primary-decision', 'mission-next-decisions', 'mission-automation-flow', 'mission-health-strip', 'mission-secondary-details']) {
  assert.ok(index.includes(marker), `missing decision-first Overview surface: ${marker}`);
}
for (const marker of ['OPERATOR_GUIDANCE', 'renderOperatorGuidance', 'Do this first', 'Maximum safe routine automation is enabled', 'finding-decision-summary', 'finding-assessment-grid', 'Unconfirmed Static Lead']) {
  assert.ok((app + styles).includes(marker) || (marker === 'Unconfirmed Static Lead' && app.includes('unconfirmed_static_lead')), `missing decision workflow marker: ${marker}`);
}
const guidanceStart = app.indexOf('const OPERATOR_GUIDANCE');
const guidanceEnd = app.indexOf('const CONTEXT_NAV');
const guidanceBlock = app.slice(guidanceStart, guidanceEnd);
const renderedSurfaces = `${index}\n${app.slice(guidanceEnd)}`;
for (const match of guidanceBlock.matchAll(/target: '([^']+)'/g)) {
  assert.ok(renderedSurfaces.includes(`id="${match[1]}"`), `recommended action target ${match[1]} has no rendered destination`);
}
assert.match(app, /page === 'mission-control'[\s\S]*refreshOperationalWorkspace\(\), loadIntelligence\(\{ render: false \}\)/);
assert.match(app, /Verdicts, containment, sandbox submission, disclosure, publication, deployment, and destructive changes still require a person/);
assert.match(index, /id="page-automation"[\s\S]*id="intelligence-title"/);
assert.match(index, /id="page-integrations"[\s\S]*id="system-view-summary"/);
assert.doesNotMatch(index, /data-system-section="automation"/);
assert.match(app, /'system\/automation': 'automation'/);
assert.doesNotMatch(app, /\["AI dependencies", "findings"\]/);
assert.doesNotMatch(app, /\["Approvals", "integrations"\]/);
assert.equal((app.match(/coverage:\s*'research\/coverage'/g) || []).length, 0, 'coverage must be owned by the standalone page route');
assert.match(app, /research-form-actions research-pipeline-actions/);
assert.match(styles, /\.research-stage-stepper\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
assert.match(styles, /\.research-stage-step\s*>\s*span:last-child\s*\{[^}]*overflow-wrap:\s*anywhere/s);
assert.match(styles, /\.research-pipeline-actions\s*>\s*button\s*\{[^}]*white-space:\s*normal/s);
for (const marker of ['task-filter-scope', 'Operator assignments', 'blog-content-filter', 'Original research', 'system-credentials', 'Credential readiness', 'Candidate promotion policy', 'finding-review-drawer']) {
  assert.ok(index.includes(marker) || app.includes(marker), `missing operator clarity surface: ${marker}`);
}
for (const marker of ['sidebar-subnav', 'sidebar-subnav-btn', 'PAGE_SUBSECTION_DEFS', 'PAGE_ROUTE_SUBSECTION_DEFS', 'primaryPageFor', 'renderSidebarSubnav', 'togglePrimarySectionNavigation', 'collapsedSidebarPrimaryPage', 'scrollIntoView']) {
  assert.ok((index + styles + app).includes(marker), `missing direct subsection navigation: ${marker}`);
}
assert.match(app, /host\.hidden = collapsedSidebarPrimaryPage === activeTopPage/);
assert.match(app, /if \(!activeTopPage\) return/);
assert.match(app, /activePrimary\?\.setAttribute\('aria-expanded', String\(!host\.hidden\)\)/);
assert.match(app, /collapsedSidebarPrimaryPage === currentPrimaryPage[\s\S]*\? null[\s\S]*: currentPrimaryPage/);
assert.match(app, /addEventListener\('click', \(\) => togglePrimarySectionNavigation\(btn\)\)/);
assert.match(styles, /\.nav-btn\[aria-controls="sidebar-subnav"\]::after/);
assert.match(styles, /\.nav-btn\[aria-expanded="true"\]::after/);
for (const marker of [
  "['Supply chain', PAGE_ROUTES['triage-ops']]",
  "['Inbox', RESEARCH_VIEW_ROUTES.inbox]",
  "['Global coverage', PAGE_ROUTES.coverage]",
  "['Original research', BLOG_VIEW_ROUTES.research]",
  "['Health', SYSTEM_VIEW_ROUTES.health]",
]) {
  assert.ok(app.includes(marker), `missing nested route ${marker}`);
}
assert.match(app, /host\.hidden = true/);
assert.match(app, /sidebar-subnav-heading.*Views/);
for (const target of ['automation-bridge-section', 'automation-request-section', 'automation-alert-review-section', 'automation-investigations-section', 'automation-daily-section', 'automation-learning-section', 'automation-jobs-section', 'edge-sensors-section', 'research-case-workspace-section', 'blog-drafts-section', 'coverage-collectors-section']) {
  assert.match(index, new RegExp(`id="${target}"`), `missing subsection target ${target}`);
}
assert.match(app, /scope: el\('task-filter-scope'\)/);
assert.match(app, /function blogDraftContentKind/);
assert.match(app, /function applyFindingSavedView/);
assert.match(app, /function restoreFindingSavedView/);
assert.match(app, /if \(linkedSecurityRecord\) return true/);
assert.match(app, /Secret values are never displayed/);

for (const view of [
  'overview',
  'model-routing',
  'artifact-fleet',
  'research',
  'findings',
  'publications',
  'enterprise',
]) {
  const key = view.includes('-') ? `['"]${view}['"]` : view;
  assert.match(readmeTour, new RegExp(`${key}\\s*:`), `missing README tour view: ${view}`);
}
assert.match(readmeTour, /Representative sample workspace/);
assert.match(readmeTour, /No credentials, customer records, private telemetry, or local-only paths/);
assert.doesNotMatch(readmeTour, /\/Users\//);
assert.doesNotMatch(readmeTour, /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
for (const marker of [
  'SecOpsAI Mission Control',
  'One Console, Clear Operator Jobs',
  'Local Quick Start',
  'Operating Modes',
  'Repository Layout',
  'representative sample data',
]) {
  assert.ok(repositoryReadme.includes(marker), `missing repository README contract: ${marker}`);
}
assert.doesNotMatch(repositoryReadme, /\/Users\//);

for (const marker of ['SecOpsAI Intelligence', 'intelligence-action-select', 'intelligence-jobs-table', 'intelligence-copy-mcp-btn', 'intelligence-result-modal', 'intelligence-result-copy', 'intelligence-result-open-case']) {
  assert.ok(index.includes(marker), `missing intelligence surface: ${marker}`);
}
for (const marker of ['source-first-research-panel', 'source-research-ecosystem', 'source-research-preview-btn', 'source-research-run-btn', 'source-research-create-case']) {
  assert.ok(index.includes(marker), `missing Source-First Artifact Research surface: ${marker}`);
}
assert.ok(!index.includes('EXACT CRATES.IO INTAKE'));
for (const marker of ['intelligence-model-select', 'intelligence-model-hint']) {
  assert.ok(index.includes(marker), `missing model selection surface: ${marker}`);
}
for (const marker of ['loadIntelligence', 'runIntelligenceAction', 'renderIntelligence', 'intelligenceModels', 'intelligenceSelectedModel', 'renderIntelligenceModelSelect', 'intelligenceResultView', 'renderIntelligenceResultModal', 'intelligenceResultMarkdown', 'openIntelligenceResult']) {
  assert.match(app, new RegExp(`function ${marker}`));
}
assert.match(app, /secopsai_bridge_model/);
assert.match(app, /runIntelligenceAction\('run-once', model \? \{ model \} : \{\}/);
assert.match(app, /Workspace-wide actions must never inherit a stale finding/);
assert.match(app, /data-intelligence-requeue/);
assert.match(app, /data-intelligence-review/);
assert.match(app, /Open full analysis/);
assert.match(app, /finding-actions/);
assert.match(app, />Review<\/button>/);
assert.match(app, /Full model analysis copied/);
assert.match(app, /runIntelligenceAction\('requeue', \{ job_id: requeueButton\.dataset\.intelligenceRequeue \}/);
assert.match(app, /id="research-pipeline-auto-review-btn"/);
assert.match(app, /runResearchCaseAction\('pipeline-auto-review',/);
assert.match(app, /Complete Agent Review/);
assert.match(app, /record an evidence-linked agent verdict/);
assert.match(app, /Generate detection proposals/);
assert.match(app, /Reference artifacts and low-confidence indicators are excluded/);
assert.match(app, /Activate detection rule/);
assert.match(styles, /\.research-rule-review-actions/);

assert.match(app, /response\.clone\(\)\.json\(\)/);
assert.match(app, /\['operator_session_required', 'operator_session_invalid'\]/);
assert.match(app, /Enter the Automation action token in Administration/);
assert.match(app, /result\.code === 'intelligence_action_unauthorized'/);
assert.equal((index.match(/id="intelligence-admin-token"/g) || []).length, 1);
assert.ok(index.indexOf('id="intelligence-admin-token"') < index.indexOf('id="intelligence-service-actions"'));
assert.ok(index.indexOf('id="intelligence-service-actions"') < index.indexOf('id="intelligence-request-title"'));

assert.match(index, /styles\.css\?v=20260830-reliability-v1/);
assert.match(index, /app\.js\?v=20260830-reliability-v1/);
assert.doesNotMatch(index, /styles\.css\?v=20260803-subsection-navigation/);
assert.match(app, /window\.addEventListener\('popstate'/);
assert.match(app, /function humanizeMachineText/);
assert.match(app, /function runRefreshAction/);
assert.match(app, /function runSourceFirstResearchAction/);
assert.match(app, /const currentButton = buttonId \? el\(buttonId\) : originalButton/);
assert.match(app, /function renderContextNav\(pageId, routeOverride = null\)/);
assert.match(app, /renderContextNav\(normalizedPageId, activeRoute\)/);
assert.match(styles, /^\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/m);
assert.match(styles, /Accessibility pass: retain the bright green control-room concept/);
assert.match(styles, /\.professional-ui \.small,[\s\S]*font-size: \.82rem/);
assert.match(styles, /\.professional-ui \.research-pipeline-operational/);
assert.match(styles, /\.professional-ui \.research-case-row\.selected[\s\S]*background: #e5f5ef/);
assert.match(styles, /\.professional-ui \.severity-pill\.high,[\s\S]*background: #fff0dc/);
assert.match(styles, /\.professional-ui \.brand-overline \{ font-size: \.66rem/);
assert.match(app, /function refreshActiveSurface/);
assert.match(app, /surfaceRefreshInFlight/);
assert.match(app, /setInterval\(\(\) => \{\s*refreshActiveSurface\(\);\s*\}, 5000\)/s);
assert.match(app, /function scheduleActionAutoRefresh/);
assert.match(app, /function refreshAfterAction/);
assert.match(app, /actionAutoRefresh: new Map\(\)/);
assert.match(app, /The console will continue updating in the background/);
for (const marker of [
  'refreshAfterAction({ key: `triage:',
  'refreshAfterAction({ key: `campaign:',
  'refreshAfterAction({ key: `research-discovery:',
  'refreshAfterAction({ key: `research-case:',
  'refreshAfterAction({ key: `research-artifact:',
  'refreshAfterAction({ key: `research-watchlist:',
  'key: `blog:',
  "await refreshAfterAction({ key: `native:"
]) {
  assert.ok(app.includes(marker), `missing post-action refresh wiring: ${marker}`);
}
assert.match(app, /window\.addEventListener\('focus', \(\) => refreshActiveSurface\(\{ force: true \}\)\)/);
assert.match(app, /const CONTEXT_SCROLL_TARGETS/);
assert.match(app, /if \(normalizedPageId === 'triage-ops'\) \{\s*renderTriageOps\(\)/s);
assert.match(app, /if \(normalizedPageId === 'coverage'\) \{\s*renderCoverage\(\)/s);
assert.match(app, /scrollToContextTarget\(routeOverride \|\| routeForPage\(normalizedPageId\)\)/);
assert.match(app, /function scrollPrimaryPageToTop/);
assert.match(app, /scrollToTarget: false/);
assert.match(app, /else scrollPrimaryPageToTop\(\)/);
assert.match(app, /inProgress \? 'In progress'/);
assert.match(app, /<th>Finished<\/th>/);
assert.match(app, /downloadApprovedSandboxArtifact/);
assert.match(app, /Download exact sample/);
assert.match(app, /Attach sanitized result/);
assert.match(app, /renderBulletList[\s\S]*humanizeMachineText\(item\)/);
assert.doesNotMatch(index, />missing_or_hallucinated</);
assert.match(app, /function requestConfirmation/);
assert.doesNotMatch(app, /\b(?:window\.)?alert\s*\(/);
assert.doesNotMatch(app, /\bconfirm\s*\(/);
console.log('professional console contract checks passed');
