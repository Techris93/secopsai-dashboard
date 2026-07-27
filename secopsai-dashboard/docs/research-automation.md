# Research Console Workflow

The primary case action is **Run Investigation Pipeline**. It combines bounded package intake, optional legitimate-package comparison, a preliminary evidence matrix, and structured Local Codex/OpenCodex Bridge analysis. Mission Control queues the work in Core and updates the case automatically. It does not require a case export, file upload, copied prompt, or model API key.

In guarded agent-review mode, **Complete Agent Review** accepts bounded proposals, attaches deterministic evidence with pipeline provenance, records an evidence-linked verdict, and reruns publication safety. Core independently enforces confidence and evidence rules; local dependency absence cannot establish benignness. Operators may still inspect and decide individual proposals. A failed run exposes **Retry from checkpoint**. When a verified comparison package becomes available, **Add reference and rerun analysis** creates a new revision and supersedes stale proposals.

The pipeline never executes package code, guesses a legitimate comparison package, submits a sandbox artifact, sends disclosure, changes customer controls, approves publication, or publishes an article. Agent review may record a guarded case verdict; the actor, model, evidence, confidence, rationale, and pipeline revision remain auditable.

The automation panel retains **Collect Metadata Preview**, **Run Safe Package Intake**, **Attach Verified Evidence**, **Generate Evidence Matrix**, **Record Human Verdict**, **Prepare Disclosure**, **Request Sandbox Approval**, **Run Publication Safety Check**, and **Approve Publication Review** as granular recovery and advanced controls. A human verdict can supersede an agent verdict when documented evidence warrants it. Blog Ops remains the final draft editing and publication surface.

Triage and Research are intentionally separate. Supply Chain Triage is an inbox for incoming alerts and leads. Research Cases are the durable investigation, disclosure, evidence, and publication record. A lead should move from triage to a case rather than being manually re-entered.

## Suggest Research Case

The Campaign Research dock includes **Suggest Research Case**. Use it after selecting a discovery candidate or after entering a normalized package campaign. The evaluator checks for package subjects, source references, behavioral indicators, validated IOCs, reviewed route, and upstream confidence. It returns one of three outcomes:

- **Draft Research Case Recommended**: the lead has enough structured package context to seed a draft.
- **Needs Human Review**: the lead may be worth preserving, but evidence or routing is incomplete.
- **Keep in Triage Ops**: the lead is not currently a package-research subject, such as a vulnerability-only or general intelligence lead.

When a draft is recommended, **Create draft case** uses the protected research action token to create a Core Research Case with status `draft`, seed normalized package subjects, and link the selected `SCM-*` finding when one is selected. It does not assert maliciousness, change the source finding status, send disclosure, create a blog post, or publish anything.

**Link existing case** is available when an SCM finding and existing case are both present. **Dismiss recommendation** is a session-only UI action; it creates no record. Review the new case on the Research Cases page before collecting evidence, requesting sandbox analysis, preparing disclosure, or creating a publication draft.

The default sandbox provider is `manual-result-import`. That is a deliberate safety state: package code is never run on the dashboard helper or Core host. A dedicated isolated provider must be configured before execution results can be submitted automatically.

For local helper operation, use the protected operator session and the configured research action token. Do not place Core, registry, email, or provider secrets in browser code or public Cloudflare Pages variables.
