import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import worker from '../_worker.js';
import {ACCESS_HEADER, ACCESS_TEST_ENV, accessJwt} from './access-test-auth.mjs';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const operatorToken = await accessJwt();
const env = {DASHBOARD_AUTH_REQUIRED: 'true', ...ACCESS_TEST_ENV, SECOPSAI_CORE_API_URL: 'https://core.example', SECOPSAI_CORE_READ_TOKEN: 'read-fixture', SECOPSAI_CORE_INTELLIGENCE_TOKEN: 'write-fixture', INTELLIGENCE_ADMIN_TOKEN: 'operator-fixture'};
function request(url, init = {}) { const headers = new Headers(init.headers || {}); headers.set(ACCESS_HEADER, operatorToken); return new Request(url, {...init, headers}); }
const original = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({url, init});
  return Response.json(init.method === 'GET' ? {schema_version: 'secopsai.research.operation.v1', editions: []} : {command_id: 'CMD-fixture', status: 'queued'});
};
try {
  const endpoint = 'https://dashboard.example/api/secopsai/research-operation';
  let response = await worker.fetch(request(endpoint), env);
  assert.equal(response.status, 200);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer read-fixture');
  // A cross-site POST cannot ride the operator's Access session.
  response = await worker.fetch(request(endpoint, {method: 'POST', headers: {'Sec-Fetch-Site': 'cross-site'}, body: '{}'}), env);
  assert.equal(response.status, 403);
  assert.equal(calls.length, 1);
  const payload = {action: 'brief-approve', actor: 'qualified.human', id: 'BRIEF-2026-10-13', request_id: 'retry-fixture', data: {expected_fingerprint: 'exact-draft', reviewed_draft: 'The complete reviewed text', checks: {claims: 'passed'}}};
  response = await worker.fetch(request(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin'}, body: JSON.stringify(payload)}), env);
  assert.equal(response.status, 202);
  assert.equal((await response.json()).queued, true);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer write-fixture');
  assert.deepEqual(JSON.parse(calls[1].init.body).payload, payload);
  assert.equal(JSON.parse(calls[1].init.body).idempotency_key, 'retry-fixture');
  assert.equal(calls[1].init.redirect, 'manual');
} finally { globalThis.fetch = original; }
console.log('research operation authorization and exact review delivery: ok');
