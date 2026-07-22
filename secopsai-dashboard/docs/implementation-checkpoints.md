# Research Automation Checkpoint

## Local Codex Investigation Pipeline

Mission Control now provides one primary **Run Investigation Pipeline** action for a selected Research Case. The typed Core gateway starts or resumes a durable pipeline, the local Codex subscription bridge processes minimized context, and the browser automatically polls until structured review proposals are ready.

Review proposals are revision-scoped and must be accepted or rejected individually. The UI exposes bridge failure recovery and verified-reference reruns while keeping verdict, sandbox, disclosure, and publication actions outside the automated pipeline. Raw artifacts and credentials never enter browser or model context.

Verification: 68 dashboard Python tests and 13 subtests passed. JavaScript console contract tests, npm audit, source checks, and desktop/mobile browser review passed. The mobile pipeline and grouped review queue have no horizontal overflow, and production authentication remains fail-closed.

The Research Cases page now calls typed Core research actions for safe package intake, evidence-matrix generation, analyst verdicts, disclosure preparation, sandbox approval requests, publication safety checks, and publication approval.

Core owns the job state and audit trail. The dashboard only displays normalized results and never receives raw artifacts or arbitrary command strings. `Attach Verified Evidence` is an explicit operator action after quarantine review.

Verification: `PYTHONPATH=. python -m pytest -q tests/test_research_automation_ui.py`, `npm test -- --run`, `npm run check`, and `node --check app.js` pass.
