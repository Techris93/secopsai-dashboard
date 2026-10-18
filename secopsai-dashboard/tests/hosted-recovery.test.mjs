import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from '../_worker.js';
import { accessJwt, ACCESS_HEADER, ACCESS_TEST_ENV } from './access-test-auth.mjs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const context = vm.createContext({});
for (const name of ['isDurableIntelligenceTarget', 'latestIntelligenceJobs', 'intelligenceRecoveryView']) {
  const start = app.indexOf(`function ${name}(`);
  const end = app.indexOf('\nfunction ', start + 1);
  vm.runInContext(app.slice(start, end), context);
}
assert.equal(context.intelligenceRecoveryView({status:'failed'}).eligible, false);
assert.equal(context.intelligenceRecoveryView({status:'failed',recovery:{eligible:false,action:'Inspect missing diagnostic'}}).action,'Inspect missing diagnostic');
const latest = context.latestIntelligenceJobs([
  {job_id:'old',action:'triage_artifact',target_id:'npm:fixture@1',status:'failed',updated_at:'2026-10-17'},
  {job_id:'recovery',action:'triage_artifact',target_id:'npm:fixture@1',status:'succeeded',updated_at:'2026-10-18'},
  {job_id:'other-version',action:'triage_artifact',target_id:'npm:fixture@2',status:'failed',updated_at:'2026-10-18'},
]);
assert.equal(latest.length,2);
assert.equal(latest.find(job=>job.target_id==='npm:fixture@1').status,'succeeded');
assert.equal(latest.find(job=>job.target_id==='npm:fixture@1').history_count,2);

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({path:new URL(url).pathname,body:JSON.parse(init.body)});
  return Response.json({count:0,eligible:[],skipped:[{job_id:'AIJ-AAAAAAAAAAAAAAAA',reason:'historical_cause_not_recorded'}]});
};
const env = {...ACCESS_TEST_ENV, SECOPSAI_CORE_API_URL:'https://core.example',SECOPSAI_CORE_INTELLIGENCE_TOKEN:'synthetic-core-secret'};
const jwt = await accessJwt();
const send = body => worker.fetch(new Request('https://dashboard.example/api/secopsai/intelligence',{
  method:'POST',headers:{[ACCESS_HEADER]:jwt,'content-type':'application/json'},body:JSON.stringify(body)}),env);
try {
  const bulk = await send({action:'requeue-failed-jobs',repair_version:'artifact-choices-v3'});
  assert.equal(bulk.status,200);
  assert.equal((await bulk.json()).result.count,0);
  assert.equal(calls[0].path,'/api/v1/intelligence/jobs/recover');
  assert.equal(calls[0].body.limit,10);
  assert.equal(calls[0].body.repair_version,undefined,'bulk action cannot re-evaluate safety failures');
  const repaired = await send({action:'requeue',job_id:'AIJ-AAAAAAAAAAAAAAAA',repair_version:'artifact-choices-v3',model:'gpt-6-luna',fallback_mode:'disabled',fallback_models:[]});
  assert.equal(repaired.status,200);
  assert.deepEqual(calls[1].body.job_ids,['AIJ-AAAAAAAAAAAAAAAA']);
  assert.equal(calls[1].body.repair_version,'artifact-choices-v3');
  assert.equal(calls[1].body.selected_model,'gpt-6-luna');
  assert.equal(JSON.stringify(calls[1].body).includes('synthetic-core-secret'),false);
  assert.equal((await send({action:'requeue'})).status,400);
} finally { globalThis.fetch = originalFetch; }
console.log('Hosted recovery routing and failure-aware UI tests passed.');
