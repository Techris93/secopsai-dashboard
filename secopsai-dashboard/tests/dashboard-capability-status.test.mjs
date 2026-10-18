import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function loadFunction(name, dependencies = {}) {
  const match = app.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `expected ${name} to be declared in app.js`);
  return new Function(...Object.keys(dependencies), `${match[0]}; return ${name};`)(...Object.values(dependencies));
}

function withState(extra = {}) {
  return {
    integrationStatus: null,
    channelRoutes: [],
    channelRoutesLoaded: false,
    channelRoutesError: null,
    localTriage: null,
    intelligence: { data: null, error: null },
    coverage: { collectors: [], loaded: false, stale: false, error: null },
    ...extra,
  };
}

const hosted = () => false;
const local = () => true;

const capabilityState = withState({
  integrationStatus: { ok: true, helper: { research: false } },
});
let capability = loadFunction('helperCapabilityStatus', {
  state: capabilityState,
  isLocalDashboardOrigin: hosted,
})('research');
assert.equal(capability.label, 'Local-only');

capabilityState.integrationStatus.helper.research = true;
capability = loadFunction('helperCapabilityStatus', {
  state: capabilityState,
  isLocalDashboardOrigin: hosted,
})('research', { error: 'Core returned HTTP 503' });
assert.equal(capability.label, 'Temporarily unavailable');
assert.match(capability.detail, /503/);

capabilityState.integrationStatus = { ok: false, error: 'status endpoint failed', helper: { research: false } };
capability = loadFunction('helperCapabilityStatus', {
  state: capabilityState,
  isLocalDashboardOrigin: hosted,
})('research');
assert.equal(capability.label, 'Status unavailable');

capabilityState.integrationStatus = { ok: true, helper: { research: false } };
capability = loadFunction('helperCapabilityStatus', {
  state: capabilityState,
  isLocalDashboardOrigin: local,
})('research', { loaded: true });
assert.equal(capability.label, 'Available', 'successful local data takes precedence over the hosted helper flag');

capabilityState.integrationStatus = { ok: false, error: 'status endpoint failed', helper: { research: true } };
capability = loadFunction('helperCapabilityStatus', {
  state: capabilityState,
  isLocalDashboardOrigin: hosted,
})('research', { loaded: true });
assert.equal(capability.label, 'Available', 'a successful direct capability read outranks a failed inventory read');
capabilityState.integrationStatus = null;
capability = loadFunction('helperCapabilityStatus', {
  state: capabilityState,
  isLocalDashboardOrigin: hosted,
})('research', { loaded: true });
assert.equal(capability.label, 'Available', 'a successful direct capability read can be shown before inventory finishes loading');

const routeState = withState();
const routeStatus = loadFunction('channelRoutesStatus', { state: routeState });
assert.equal(routeStatus().label, 'Channel routes loading');
routeState.channelRoutesError = 'D1 read failed';
assert.equal(routeStatus().label, 'Channel routes unavailable');
routeState.channelRoutesError = null;
routeState.channelRoutesLoaded = true;
assert.equal(routeStatus().label, '0 channel routes configured');
assert.match(routeStatus().detail, /query succeeded/);
routeState.channelRoutes = [{ id: 'route-1', active: true }];
assert.equal(routeStatus().label, '1 channel route loaded');
routeState.channelRoutesError = 'refresh failed';
assert.equal(routeStatus().label, 'Channel routes stale');
const activeRouteStatus = loadFunction('activeChannelRoutesPresentation', { state: routeState });
assert.equal(activeRouteStatus().label, '1 active · stale');
routeState.channelRoutesLoaded = false;
routeState.channelRoutesError = 'initial query failed';
assert.equal(activeRouteStatus().label, 'Unavailable');
routeState.channelRoutesLoaded = true;
routeState.channelRoutesError = null;
routeState.channelRoutes = [];
assert.equal(activeRouteStatus().label, '0 active · none configured');

const investigationStatus = loadFunction('investigationAutopilotStatus', {
  state: withState(),
  isLocalDashboardOrigin: hosted,
  humanizeSnake: value => String(value),
});
assert.equal(investigationStatus({ mode: 'hosted-core' }).label, 'Local-only');
assert.equal(investigationStatus({ mode: 'local-helper', investigations: { settings: { mode: 'guarded' } } }).label, 'guarded');
assert.equal(investigationStatus({ mode: 'local-helper', investigations: {} }).label, 'Status unavailable');

const coverageState = withState({
  integrationStatus: { ok: true, helper: { secopsai_research_api: true } },
  coverage: { collectors: [], events: [], windows: [], loaded: true, stale: false, error: null },
});
const coverageCapability = loadFunction('helperCapabilityStatus', {
  state: coverageState,
  isLocalDashboardOrigin: hosted,
});
const coverageStatus = loadFunction('sourceCoveragePresentation', {
  state: coverageState,
  helperCapabilityStatus: coverageCapability,
  coverageCollectorHealth: () => 'Healthy',
});
assert.equal(coverageStatus().label, '0 collectors configured');
coverageState.coverage.collectors = [{ name: 'npm', enabled: true }];
assert.equal(coverageStatus().label, '1/1 healthy');
coverageState.coverage.error = 'network timeout';
coverageState.coverage.stale = true;
assert.equal(coverageStatus().label, 'Stale');
assert.match(app, /Showing the last successful coverage snapshot[\s\S]*Refresh failed/);
assert.match(app, /if \(localOnly \|\| !coverage\.loaded\)[\s\S]*Showing the last successful coverage snapshot/);
coverageState.integrationStatus.helper.secopsai_research_api = false;
assert.equal(coverageStatus().label, 'Local-only');

assert.match(app, /if \(!response\.ok \|\| payload\.ok === false\) \{[\s\S]*?state\.specialists\.error/);
assert.match(app, /result\.catalog && typeof result\.catalog === 'object'[\s\S]*Array\.isArray\(result\.runs\)/);
assert.match(app, /Coverage response omitted a required collector, event, or window list/);
assert.match(app, /investigations\.availability === 'local_only'[\s\S]*investigationRunButton\.disabled = investigationUnavailable/);
assert.match(app, /state\.channelRoutesError = err\.message \|\| String\(err\)/);
assert.match(app, /payload\.ok !== true \|\| !payload\.summary[\s\S]*?Native triage returned an invalid status response/);
assert.match(app, /const canManagePolicy = capability\.label === 'Available' && !state\.specialists\.stale && !state\.specialists\.error/);
assert.match(app, /policyModeControl\.disabled = !canManagePolicy/);
assert.match(app, /const dailySettingsKnown = modelStatusKnown && typeof dailySettings\.enabled === 'boolean'/);
assert.match(app, /const specialistPolicyKnown = Boolean\(state\.specialists\.data && !state\.specialists\.stale && !state\.specialists\.error/);
assert.match(app, /const triageFresh = Boolean\(triageSummary && state\.localTriage\?\.ok === true && !state\.localTriage\?\.stale\)/);
assert.match(app, /Native triage snapshot is stale/);
assert.match(app, /activeChannelRoutesPresentation\(\)\.label/);
assert.match(app, /const coverageFresh = state\.coverage\.loaded && !state\.coverage\.stale && !state\.coverage\.error/);
assert.match(app, /coverageFresh && Array\.isArray\(state\.coverage\.collectors\)/);

console.log('dashboard capability and status contracts: ok');
