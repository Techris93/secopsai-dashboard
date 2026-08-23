# Dashboard Contrast Audit (2026-08)

## Root cause

The console had several theme layers in one stylesheet. The base dashboard and
the later ASD/S1000D layer defined a bright paper-like surface, but older
OKComputer and command-surface rules remained active with higher-specificity
selectors. Those rules set pale text such as `#b8c2d6`, `#a2a2b7`, and
`#f0f0f5` on white or pale-green panels. Some task, findings, Triage Ops, and
Guide selectors also restored dark backgrounds after the bright theme. The
result was content that appeared only after a hover rule changed its surface.

The issue was reproduced from computed styles, not only from screenshots. The
pre-fix audit measured examples between roughly 1.0:1 and 2.5:1, including
task labels, Triage Ops headings, research actions, and guide callouts.

## Fix

`styles.css` now ends with a named **Bright contrast correction** layer. It
maps legacy variables to a central bright palette and explicitly covers the
high-specificity surfaces that previously escaped the light theme:

- Main content uses `#f3f7f5` / `#ffffff` surfaces and `#17211e` primary text.
- Secondary text uses `#40534b`, `#53645d`, or `#62716b` instead of pale
  dark-theme text.
- Green controls use `#087963` with white text; green status backgrounds use
  dark green text.
- Task boards, Findings, Triage Ops, Research, Blog Ops, Guide, Enterprise
  content, dialogs, drawers, and command surfaces are covered.
- Legacy overview cockpit cards, metric captions, work-table links, severity
  labels, native select options, and automation evidence markers are covered
  by explicit resting-state rules so they do not become readable only on hover.
- Findings badges, inline action menus, and the Work scope note also use the
  bright surface tokens; these were dynamic residuals found by the final
  computed-style sweep.
- The navigation rail and Enterprise setup banner remain intentionally dark,
  with explicit light text tokens and measured contrast.
- Focus indicators are visible at rest, disabled controls remain legible with
  a 0.9 opacity cap (rather than the old low-contrast fade), and required
  content no longer depends on hover.

The stylesheet URL is cache-busted with `20260823-bright-contrast-v2` after the
final dynamic-surface corrections.

## Evidence and verification

Before/after local captures were taken at:

- `/tmp/secopsai-dashboard-contrast-before.png`
- `/tmp/secopsai-dashboard-contrast-after.png`
- `/tmp/secopsai-dashboard-contrast-workspace-final-v3.png` (final workspace
  capture after the dynamic-surface corrections)

The browser computed-style audit was rerun after the fix across the Overview,
Findings, Assets, Work, Research, Publications, Automation, System,
Enterprise, Triage Ops, Global Coverage, and Guide routes, plus dialogs, forms,
tables, buttons, and status elements. No content-plane element below 4.5:1
remained in the representative inventory. The dark navigation rail was
checked separately; its muted text is at least 9.6:1 against the rail surface.
The Research route includes Campaign Research and Artifact Fleet panels; both
were included in the Research-state pass.

The regression contract is in
`tests/test_dashboard_contrast.py`. It checks the central tokens, WCAG AA
ratios, focus/disabled rules, representative high-specificity selectors, and
the cache-busted stylesheet revision.

Future UI changes should use the shared contrast tokens, test the resting state
before hover, and verify normal text at 4.5:1 or higher. A hover style may
indicate selection, but must never be required to reveal text or a control.
