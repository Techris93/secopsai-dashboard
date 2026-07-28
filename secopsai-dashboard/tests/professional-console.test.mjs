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
for (const route of ['research/inbox', 'research/cases', 'research/watchlists', 'research/coverage', 'research/disclosure', 'research/sandbox', 'publications/news', 'publications/drafts', 'publications/review', 'publications/published', 'system/health', 'system/integrations', 'system/automation', 'system/credentials', 'system/audit']) {
  assert.match(app, new RegExp(route.replace('/', '\\/')));
}
for (const marker of ['research-view-summary', 'publication-view-summary', 'system-view-summary', 'data-research-section="inbox watchlists"', 'data-research-section="cases disclosure sandbox"', 'data-blog-section="news"', 'data-system-section="automation"', 'metric-scope']) {
  assert.ok((index + styles + app).includes(marker), `missing redesign contract: ${marker}`);
}

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
assert.match(app, /Full model analysis copied/);
assert.match(app, /runIntelligenceAction\('requeue', \{ job_id: requeueButton\.dataset\.intelligenceRequeue \}/);
assert.match(app, /id="research-pipeline-auto-review-btn"/);
assert.match(app, /runResearchCaseAction\('pipeline-auto-review',/);
assert.match(app, /Complete Agent Review/);
assert.match(app, /record an evidence-linked agent verdict/);

assert.match(app, /response\.clone\(\)\.json\(\)/);
assert.match(app, /\['operator_session_required', 'operator_session_invalid'\]/);
assert.match(app, /Enter the local Intelligence action credential before using bridge controls\./);
assert.match(app, /result\.code === 'intelligence_action_unauthorized'/);
assert.equal((index.match(/id="intelligence-admin-token"/g) || []).length, 1);
assert.ok(index.indexOf('id="intelligence-admin-token"') < index.indexOf('id="intelligence-service-actions"'));
assert.ok(index.indexOf('id="intelligence-service-actions"') < index.indexOf('id="intelligence-request-title"'));

assert.match(index, /20260727-full-intelligence-results/);
assert.match(app, /window\.addEventListener\('popstate'/);
assert.match(app, /function requestConfirmation/);
assert.doesNotMatch(app, /\b(?:window\.)?alert\s*\(/);
assert.doesNotMatch(app, /\bconfirm\s*\(/);
console.log('professional console contract checks passed');
