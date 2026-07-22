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

for (const marker of ['SecOpsAI Intelligence', 'intelligence-action-select', 'intelligence-jobs-table', 'intelligence-copy-mcp-btn']) {
  assert.ok(index.includes(marker), `missing intelligence surface: ${marker}`);
}
for (const marker of ['loadIntelligence', 'runIntelligenceAction', 'renderIntelligence']) {
  assert.match(app, new RegExp(`function ${marker}`));
}

assert.match(app, /response\.clone\(\)\.json\(\)/);
assert.match(app, /\['operator_session_required', 'operator_session_invalid'\]/);
assert.match(app, /Enter the local Intelligence action credential before using bridge controls\./);
assert.match(app, /result\.code === 'intelligence_action_unauthorized'/);
assert.equal((index.match(/id="intelligence-admin-token"/g) || []).length, 1);
assert.ok(index.indexOf('id="intelligence-admin-token"') < index.indexOf('id="intelligence-service-actions"'));
assert.ok(index.indexOf('id="intelligence-service-actions"') < index.indexOf('id="intelligence-request-title"'));

assert.match(index, /20260722-asd-console-theme/);
assert.match(app, /window\.addEventListener\('popstate'/);
assert.match(app, /function requestConfirmation/);
assert.doesNotMatch(app, /\b(?:window\.)?alert\s*\(/);
assert.doesNotMatch(app, /\bconfirm\s*\(/);
console.log('professional console contract checks passed');
