// Browser-side contract for an expired Cloudflare Access session: the console
// must offer "Sign in again" (a full reload through Access), never a password
// form or a Supabase error.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

class FakeElement {
  constructor(id) {
    this.id = id;
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.dataset = {};
    this.attributes = {};
    const classes = new Set(id === 'auth-reauth-btn' ? ['hidden'] : []);
    this.classes = classes;
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, force) => (force ?? !classes.has(name)) ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener() {}
  focus() {}
  querySelectorAll() { return []; }
  querySelector() { return null; }
  closest() { return null; }
}

function loadConsole({ config, fetch }) {
  const elements = new Map();
  const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const reloads = [];
  const document = {
    hidden: false,
    body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} },
    documentElement: { scrollTop: 0 },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    createElement(id) { return new FakeElement(id); },
  };
  const location = {
    search: '', hash: '', pathname: '/', origin: 'https://dashboard.secopsai.dev', hostname: 'dashboard.secopsai.dev',
    href: 'https://dashboard.secopsai.dev/', reload() { reloads.push('reload'); }, assign(url) { reloads.push(url); },
  };
  const window = { addEventListener() {}, removeEventListener() {}, location, fetch, setTimeout: (fn) => fn() };
  if (config) window.SECOPSAI_CONFIG = config;
  const context = {
    window, document, location, sessionStorage: storage, localStorage: storage,
    MutationObserver: class { observe() {} }, fetch, console,
    setInterval() { return 0; }, clearInterval() {}, setTimeout, clearTimeout,
    URL, URLSearchParams, FormData, Blob, Headers, Response, Intl, Date, Math, JSON,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, Number, String, Boolean,
    Object, Array, RegExp, Error, Promise, Map, Set, WeakMap, WeakSet,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(appSource, context, { filename: 'app.js' });
  return { context, elements, reloads, el: (id) => document.getElementById(id) };
}

const ACCESS_CONFIG = { auth: { required: true, mode: 'access' }, dataEndpoint: '/api/data', sessionEndpoint: '/api/session' };

// 1. Access redirected config.js to its login, so SECOPSAI_CONFIG never loaded.
{
  const ui = loadConsole({ config: null, fetch: async () => { throw new Error('no network expected'); } });
  await vm.runInContext('initializeDashboardAuth()', ui.context);
  assert.equal(ui.el('auth-title').textContent, 'Session expired');
  assert.match(ui.el('auth-message').textContent, /Cloudflare Access session has expired/);
  assert.doesNotMatch(ui.el('auth-message').textContent, /supabase/i);
  assert.equal(ui.el('auth-reauth-btn').classList.contains('hidden'), false);
  vm.runInContext('reauthenticateThroughAccess()', ui.context);
  assert.deepEqual(ui.reloads, ['reload']);
}

// 2. A live session expires: the next API call is redirected by Access.
{
  const calls = [];
  const fetch = async (input, init = {}) => {
    calls.push({ input: String(input), redirect: init.redirect });
    return { type: 'opaqueredirect', status: 0, ok: false, clone() { return this; }, json: async () => ({}) };
  };
  const ui = loadConsole({ config: ACCESS_CONFIG, fetch });
  await assert.rejects(vm.runInContext("dashboardApiFetch('/api/data/work_items')", ui.context), /Access session expired/);
  assert.equal(calls[0].redirect, 'manual');
  assert.equal(ui.el('auth-title').textContent, 'Session expired');
  assert.equal(ui.el('auth-reauth-btn').classList.contains('hidden'), false);
}

// 3. A valid Access session enters the console without any sign-in form.
{
  const fetch = async (input) => {
    if (String(input).includes('/api/session')) {
      return { type: 'basic', status: 200, ok: true, clone() { return this; }, json: async () => ({ ok: true, email: 'operator@example.com' }) };
    }
    return { type: 'basic', status: 200, ok: true, clone() { return this; }, json: async () => ({ ok: true, data: [] }) };
  };
  const ui = loadConsole({ config: ACCESS_CONFIG, fetch });
  const { data } = await vm.runInContext('dataClient.auth.getSession()', ui.context);
  assert.equal(data.session.user.email, 'operator@example.com');
}

// 4. Behind Access the console sign-in authorizes actions: no token fields, and
//    no pasted action token ever leaves the browser.
{
  const sent = [];
  const fetch = async (input, init = {}) => {
    sent.push(new Headers(init.headers));
    return { type: 'basic', status: 200, ok: true, clone() { return this; }, json: async () => ({ ok: true }) };
  };
  const ui = loadConsole({ config: ACCESS_CONFIG, fetch });
  vm.runInContext('adoptConsoleActionAuthorization()', ui.context);
  for (const id of ['intelligence-token-field', 'research-access-section', 'blog-access-section', 'triage-access-section']) {
    assert.equal(ui.el(id).hidden, true, `${id} must be hidden behind Access`);
  }
  assert.equal(vm.runInContext('Boolean(state.triageOps.adminToken && state.blogOps.adminToken && state.intelligence.adminToken)', ui.context), true);
  await vm.runInContext(`dashboardApiFetch('/api/secopsai/triage-ops/close', { method: 'POST', headers: { 'X-Triage-Ops-Admin-Token': state.triageOps.adminToken, 'X-SecOpsAI-Intelligence-Token': 'x', 'X-Blog-Ops-Admin-Token': 'y' } })`, ui.context);
  for (const name of ['X-Triage-Ops-Admin-Token', 'X-SecOpsAI-Intelligence-Token', 'X-Blog-Ops-Admin-Token']) {
    assert.equal(sent[0].has(name), false, `${name} must not be sent`);
  }
  assert.match(vm.runInContext('triageOpsAdminTokenHint()', ui.context), /authorized by your console sign-in/);
}

// 5. Supabase is retired: no shipped asset may reference it again.
for (const file of ['index.html', 'app.js', '_worker.js', 'data-api.js', 'url-safety.js', 'styles.css', 'view-run-output.html', 'view-run-output.js', 'config.template.js']) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(source, /supabase/i, `${file} must not reference Supabase`);
}

console.log('access session runtime checks passed');
