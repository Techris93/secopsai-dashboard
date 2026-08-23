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

### Stale frontend bundle

The first live Chrome probe also showed that the browser was still loading the
previous `app.js?v=20260803-subsection-navigation` bundle, which contained the
old `navigateTo` handler. The HTML cache key is now advanced to
`app.js?v=20260823-action-audit` so a normal refresh fetches the repaired
handler instead of relying on a user to clear browser cache.

## Verification evidence

- `npm run check` passed (`node --check` for application and worker files).
- `npm test` passed (Blog Ops worker and professional console contracts).
- Full Python dashboard suite passed: `111 passed, 13 subtests passed`.
- Focused action, Research, enterprise, security, and coverage contracts
  passed: `56 passed`.
- Cache-key regression contract passed with the focused action tests (`16
  passed` for the final action/intelligence subset).
- Triage Ops unit suite passed: `44 tests`.
- Core SecOpsAI suite passed: `619 passed, 4 subtests passed`.
- `python3 -m py_compile dashboard_server.py` passed.
- `git diff --check` passed.
- Static button audit found no unreferenced fixed-ID controls after allowing
  the documented Artifact Fleet delegated-action IDs.

Chrome was available for a live read-only verification. The authenticated
Overview snapshot showed the primary navigation with no subsection expanded,
and the Work → Automation → Investigations panel exposed 20 visible case rows.
The first click attempt was intentionally made before refreshing the cached
bundle and reproduced the old `ReferenceError: navigateTo is not defined` from
`app.js?v=20260803-subsection-navigation`. After the cache-key fix, the local
session expired and required re-authentication, so a post-fix authenticated
click could not be completed without the operator signing in again. The source
trace, cache-bust contract, deterministic tests, and local test suite provide
the reproducible evidence; after the next sign-in, verify one queue row with
`Open case` and one invalid/missing case response in the refreshed dashboard.

The GitHub Pages deployment workflow ran successfully for the pushed commits,
but reported `Cloudflare deployment skipped: production secrets are not
configured.` No Cloudflare credentials were changed or added locally.

## Safety preserved

No approval gates, admin-token checks, helper boundaries, publication controls,
or browser shell restrictions were changed. The fix only corrects routing,
feedback, and startup presentation state.
