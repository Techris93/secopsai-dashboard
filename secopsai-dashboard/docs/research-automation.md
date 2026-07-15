# Research Console Workflow

The Research Cases page now exposes the investigation workflow as typed buttons. Use **Run Safe Package Intake** for a selected package subject, review the quarantine result, and then use **Attach Verified Evidence**. The dashboard never sends arbitrary shell commands to Core.

The automation panel also provides **Collect Metadata Preview**, **Generate Evidence Matrix**, **Record Human Verdict**, **Prepare Disclosure**, **Request Sandbox Approval**, **Run Publication Safety Check**, and **Approve Publication Review**. Blog Ops remains the final draft editing and publication surface.

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
