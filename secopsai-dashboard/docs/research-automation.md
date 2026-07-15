# Research Console Workflow

The Research Cases page now exposes the investigation workflow as typed buttons. Use **Run Safe Package Intake** for a selected package subject, review the quarantine result, and then use **Attach Verified Evidence**. The dashboard never sends arbitrary shell commands to Core.

The automation panel also provides **Collect Metadata Preview**, **Generate Evidence Matrix**, **Record Human Verdict**, **Prepare Disclosure**, **Request Sandbox Approval**, **Run Publication Safety Check**, and **Approve Publication Review**. Blog Ops remains the final draft editing and publication surface.

Triage and Research are intentionally separate. Supply Chain Triage is an inbox for incoming alerts and leads. Research Cases are the durable investigation, disclosure, evidence, and publication record. A lead should move from triage to a case rather than being manually re-entered.

The default sandbox provider is `manual-result-import`. That is a deliberate safety state: package code is never run on the dashboard helper or Core host. A dedicated isolated provider must be configured before execution results can be submitted automatically.

For local helper operation, use the protected operator session and the configured research action token. Do not place Core, registry, email, or provider secrets in browser code or public Cloudflare Pages variables.
