# Research Automation Checkpoint

The Research Cases page now calls typed Core research actions for safe package intake, evidence-matrix generation, analyst verdicts, disclosure preparation, sandbox approval requests, publication safety checks, and publication approval.

Core owns the job state and audit trail. The dashboard only displays normalized results and never receives raw artifacts or arbitrary command strings. `Attach Verified Evidence` is an explicit operator action after quarantine review.

Verification: `PYTHONPATH=. python -m pytest -q tests/test_research_automation_ui.py`, `npm test -- --run`, `npm run check`, and `node --check app.js` pass.
