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

assert.match(index, /20260715-professional-console/);
assert.match(app, /window\.addEventListener\('popstate'/);
assert.match(app, /function requestConfirmation/);
assert.doesNotMatch(app, /\b(?:window\.)?alert\s*\(/);
assert.doesNotMatch(app, /\bconfirm\s*\(/);
console.log('professional console contract checks passed');
