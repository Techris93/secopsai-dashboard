# Dashboard Action Audit (2026-08)

## Scope

This audit covers the SecOpsAI control center action wiring, with emphasis on
the investigation queue, Research case navigation, Research discovery inbox,
startup navigation state, and browser-injected errors.

## Findings and fixes

### Investigation queue: Open case

The investigation table rendered an `Open case` button with a
`data-investigation-case` value, but its delegated click handler called
`navigateTo('research/cases')`. No `navigateTo` function exists in the dashboard;
the real route function is `setPage`. The click therefore raised a
`ReferenceError` before the selected case or its detail could be loaded.

The fix is a single `openResearchCase(caseId)` helper. It now:

- normalizes and validates the `RSC-` case identifier;
- switches to the Research Cases route;
- refreshes the case list while preserving the requested selection;
- loads the exact requested case detail, even when it is not the first list row;
- renders a clear invalid/unavailable or API error; and
- is reused by the investigation queue, intelligence result modal, and Rust
  package research follow-up.

This removes three separate case-opening implementations and prevents the
same navigation bug from returning through another entry point.

### Research discovery inbox

The `research-inbox-refresh-btn` existed in the HTML but had no click binding.
It now uses the standard refresh/busy/error feedback path and reloads discovery
candidates through `loadResearchDiscovery()`.

### Browser-injected `ethereum` error

The dashboard does not define or use `window.ethereum`. The reported
`Cannot redefine property: ethereum` error is produced by a wallet/browser
extension that injects a property before or alongside the dashboard. The
global error banner now ignores only this exact collision when the source is
unknown or an extension URL (`chrome-extension://`, `moz-extension://`, or
`safari-extension://`). Ordinary application errors continue to appear in the
banner, so this is not a blanket error suppression.

### Sidebar section open after login or refresh

`renderSidebarSubnav()` intentionally displays the active section when
`collapsedSidebarPrimaryPage` is unset. Boot and authentication both called
`setPage()` before setting that state, so every fresh load appeared to have a
section expanded. `collapseSidebarForInitialRoute()` now sets the active
primary section as collapsed during both initial DOM boot and authenticated
session entry. Normal operator navigation still opens the chosen section and
the existing toggle closes/reopens it deliberately.

## Verification evidence

- `npm run check` passed (`node --check` for application and worker files).
- `npm test` passed (Blog Ops worker and professional console contracts).
- Full Python dashboard suite passed: `110 passed, 13 subtests passed`.
- Focused action, Research, enterprise, security, and coverage contracts
  passed: `56 passed`.
- `python3 -m py_compile dashboard_server.py` passed.
- `git diff --check` passed.
- Static button audit found no unreferenced fixed-ID controls after allowing
  the documented Artifact Fleet delegated-action IDs.

The available in-app browser session was signed out and the Chrome connector
was unavailable, so an authenticated live click on an existing case could not
be performed in this run. The source-level trace, deterministic contracts, and
local test suite provide the reproducible evidence; after deployment, an
operator should verify one queue row with `Open case` and one invalid/missing
case response in the signed-in dashboard.

## Safety preserved

No approval gates, admin-token checks, helper boundaries, publication controls,
or browser shell restrictions were changed. The fix only corrects routing,
feedback, and startup presentation state.
