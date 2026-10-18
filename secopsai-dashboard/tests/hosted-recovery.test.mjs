import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from '../_worker.js';
import { accessJwt, ACCESS_HEADER, ACCESS_TEST_ENV } from './access-test-auth.mjs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const context = vm.createContext({ state: { intelligence: {} }, intelligenceModels: () => [] });
for (const name of ['isDurableIntelligenceTarget', 'latestIntelligenceJobs', 'intelligenceRecoveryView', 'intelligenceSelectedModel', 'intelligenceRecoveryRouting']) {
  const start = app.indexOf(`function ${name}(`);
  const end = app.indexOf('\nfunction ', start + 1);
  vm.runInContext(app.slice(start, end), context);
}
context.state.intelligence.selectedModel = 'gpt-6-luna';
assert.equal(context.intelligenceSelectedModel(), 'gpt-6-luna', 'stored model remains usable while the catalog is temporarily empty');
context.state.intelligence.selectedModel = '';
assert.equal(context.intelligenceSelectedModel(), '', 'recovery does not invent a model when none is available');
assert.equal(JSON.stringify(context.intelligenceRecoveryRouting(' gpt-6-luna ')), JSON.stringify({model:'gpt-6-luna',fallback_mode:'disabled',fallback_models:[]}));
assert.equal(context.intelligenceRecoveryRouting(''), null, 'recovery routing is unavailable without a selected model');
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
const legacy = context.latestIntelligenceJobs([
  {job_id:'legacy-failed',action:'triage_artifact',target_id:'FASTLANE-npm:fixture@1',status:'failed',updated_at:'2026-10-17'},
  {job_id:'legacy-repaired',action:'triage_artifact',target_id:'FASTLANE-npm:fixture@1',status:'succeeded',updated_at:'2026-10-18'},
]);
assert.equal(legacy.length,1);
assert.equal(legacy[0].status,'succeeded');
assert.equal(legacy[0].history_count,2);

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
  const missingRoute = await send({action:'recover-transient-jobs',limit:10,max_attempts:3,min_age_seconds:300});
  assert.equal(missingRoute.status,422);
  assert.equal(calls.length,0,'missing routing fails locally rather than returning per-target legacy routing skips');
  const bulk = await send({action:'requeue-failed-jobs',repair_version:'artifact-choices-v3',model:'gpt-6-luna',fallback_mode:'disabled',fallback_models:[]});
  assert.equal(bulk.status,200);
  assert.equal((await bulk.json()).result.count,0);
  assert.equal(calls[0].path,'/api/v1/intelligence/jobs/recover');
  assert.equal(calls[0].body.limit,10);
  assert.equal(calls[0].body.repair_version,undefined,'bulk action cannot re-evaluate safety failures');
  assert.equal(calls[0].body.selected_model,'gpt-6-luna');
  const repaired = await send({action:'requeue',job_id:'AIJ-AAAAAAAAAAAAAAAA',repair_version:'artifact-choices-v3',model:'gpt-6-luna',fallback_mode:'disabled',fallback_models:[]});
  assert.equal(repaired.status,200);
  assert.deepEqual(calls[1].body.job_ids,['AIJ-AAAAAAAAAAAAAAAA']);
  assert.equal(calls[1].body.repair_version,'artifact-choices-v3');
  assert.equal(calls[1].body.selected_model,'gpt-6-luna');
  assert.equal(JSON.stringify(calls[1].body).includes('synthetic-core-secret'),false);
  assert.equal((await send({action:'requeue'})).status,400);
  const transient = await send({action:'recover-transient-jobs',limit:10,max_attempts:3,min_age_seconds:300,model:'gpt-6-luna',fallback_mode:'disabled',fallback_models:[]});
  assert.equal(transient.status,200);
  assert.equal(calls[2].body.limit,10);
  assert.equal(calls[2].body.max_attempts,3);
  assert.equal(calls[2].body.min_age_seconds,300);
  assert.equal(calls[2].body.selected_model,'gpt-6-luna');
  assert.deepEqual(calls[2].body.fallback_models,[]);
  assert.equal(calls[2].body.fallback_mode,'disabled');
} finally { globalThis.fetch = originalFetch; }
console.log('Hosted recovery routing and failure-aware UI tests passed.');
