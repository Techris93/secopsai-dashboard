import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const index = read('index.html');
const app = read('app.js');
const styles = read('styles.css');

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
assert.match(app, /scope: el\('task-filter-scope'\)/);
assert.match(app, /function blogDraftContentKind/);
assert.match(app, /function applyFindingSavedView/);
assert.match(app, /function restoreFindingSavedView/);
assert.match(app, /if \(linkedSecurityRecord\) return true/);
assert.match(app, /Secret values are never displayed/);

for (const marker of ['SecOpsAI Intelligence', 'intelligence-action-select', 'intelligence-jobs-table', 'intelligence-copy-mcp-btn', 'intelligence-result-modal', 'intelligence-result-copy', 'intelligence-result-open-case']) {
  assert.ok(index.includes(marker), `missing intelligence surface: ${marker}`);
}
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
assert.match(app, /Enter the local Intelligence action credential before using bridge controls\./);
assert.match(app, /result\.code === 'intelligence_action_unauthorized'/);
assert.equal((index.match(/id="intelligence-admin-token"/g) || []).length, 1);
assert.ok(index.indexOf('id="intelligence-admin-token"') < index.indexOf('id="intelligence-service-actions"'));
assert.ok(index.indexOf('id="intelligence-service-actions"') < index.indexOf('id="intelligence-request-title"'));

assert.match(index, /20260727-full-intelligence-results/);
assert.match(app, /window\.addEventListener\('popstate'/);
assert.match(app, /function humanizeMachineText/);
assert.match(app, /function runRefreshAction/);
assert.match(app, /const currentButton = buttonId \? el\(buttonId\) : originalButton/);
assert.match(app, /function refreshActiveSurface/);
assert.match(app, /surfaceRefreshInFlight/);
assert.match(app, /setInterval\(\(\) => \{\s*refreshActiveSurface\(\);\s*\}, 15000\)/s);
assert.match(app, /window\.addEventListener\('focus', \(\) => refreshActiveSurface\(\{ force: true \}\)\)/);
assert.match(app, /renderBulletList[\s\S]*humanizeMachineText\(item\)/);
assert.doesNotMatch(index, />missing_or_hallucinated</);
assert.match(app, /function requestConfirmation/);
assert.doesNotMatch(app, /\b(?:window\.)?alert\s*\(/);
assert.doesNotMatch(app, /\bconfirm\s*\(/);
console.log('professional console contract checks passed');
