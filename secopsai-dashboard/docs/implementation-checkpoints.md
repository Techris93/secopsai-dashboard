# Research Automation Checkpoint

## Full Intelligence Result Review

Mission Control now opens complete structured results from **System → Analysis jobs**. The result workspace separates facts, inferences, contradictions, unsupported claims, missing evidence, next steps, verdict rationale, publication risks, article structure, disclosure text, limitations, and the durable job audit history. Operators can copy a complete Markdown record or open the canonical Research Case directly. The normalized JSON remains available for reproducibility and troubleshooting.

Regression checks prevent a future renderer from collapsing completed frontier-model output back into a generic summary. Browser verification uses a representative Braintree case fixture derived from the normalized result shape and covers modal interaction plus desktop/mobile readability. The production sign-in gate remains fail-closed; authenticated live-case acceptance is a deployment check rather than a test bypass.

## Guarded Agent Research Completion

Mission Control now exposes **Complete Agent Review** for an investigation pipeline that has finished model analysis. The typed gateway calls Core's `research pipeline agent-complete` action. Core accepts bounded, revision-scoped proposals, attaches pipeline evidence, records a guarded evidence-linked verdict, and reruns publication safety. The UI displays the resulting verdict and confidence instead of implying that every decision still requires manual card review.

The boundary remains explicit: the action cannot execute packages, submit an external sandbox artifact, send disclosure, change customer controls, approve publication, or publish content. Local dependency absence cannot support a benign verdict. Operators can still use the individual Accept/Reject controls or record a documented human superseding verdict.

Verification covers typed command mapping, unsafe-target rejection, confirmation copy, fixture rendering, Python UI tests, JavaScript console contracts, syntax checks, and the full dashboard suite.

The System model picker now feeds **Install service** as well as **Process next job**. Mission Control persists the selected model identifier and `agent_review` mode in the local service command, preventing a background restart from silently reverting to another model. Model identifiers are allowlisted; credentials are never written by the dashboard.

## Local Codex Investigation Pipeline

Mission Control now provides one primary **Run Investigation Pipeline** action for a selected Research Case. The typed Core gateway starts or resumes a durable pipeline, the local Codex subscription bridge processes minimized context, and the browser automatically polls until structured review proposals are ready.

Review proposals are revision-scoped. They may be accepted or rejected individually in supervised mode, or completed together by the guarded agent-review action. The UI exposes bridge failure recovery and verified-reference reruns while keeping external sandbox submission, disclosure delivery, customer-control changes, and publication outside the automated pipeline. Raw artifacts and credentials never enter browser or model context.

Verification: 68 dashboard Python tests and 13 subtests passed. JavaScript console contract tests, npm audit, source checks, and desktop/mobile browser review passed. The mobile pipeline and grouped review queue have no horizontal overflow, and production authentication remains fail-closed.

The Research Cases page now calls typed Core research actions for safe package intake, evidence-matrix generation, analyst verdicts, disclosure preparation, sandbox approval requests, publication safety checks, and publication approval.

Core owns the job state and audit trail. The dashboard only displays normalized results and never receives raw artifacts or arbitrary command strings. `Attach Verified Evidence` is an explicit operator action after quarantine review.

Verification: `PYTHONPATH=. python -m pytest -q tests/test_research_automation_ui.py`, `npm test -- --run`, `npm run check`, and `node --check app.js` pass.

## Package Threat And Exposure UI

Mission Control now shows all active package intelligence by default and
separates **Package verdict** from **Local exposure**. A package that is absent
from the SecOpsAI repository appears as **Ecosystem intelligence**, preserves
its scanner severity, and remains available for evidence collection, Research
Case promotion, and publication review. Local absence no longer creates a
`not_applicable` recommendation, hides the alert, or disables research output.

Only package-level evidence can support a false-positive downgrade. The UI says
`not observed in this repository` instead of claiming `no local impact`, because
other repositories, transitive dependencies, CI caches, containers, and
deployed workloads remain outside that search scope.

Verification: 68 dashboard Python tests and 13 subtests passed; JavaScript
contract tests, syntax checks, dashboard checks, and repository diff checks
passed.
