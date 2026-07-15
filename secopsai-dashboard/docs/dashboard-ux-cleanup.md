# Dashboard UX Cleanup - June 2026

This audit focused on the Triage Ops advanced dock: Supply Chain Alerts,
Autonomous Discovery, Campaign Research, Orchestrator Review, watchlist
suggestions, and Blog Ops action semantics.

## Findings

| Area | Finding | Resolution |
| --- | --- | --- |
| Discovery actions | Discovery exposed write-oriented `Persist Findings` and `Create Review-Only Blog Draft` buttons next to read-only candidate review. | Removed those buttons from Discovery. Operators now promote a validated lead, run Campaign Research, then use token-gated Campaign Research write actions. |
| Campaign Research actions | `Correlate Campaign` and `Check Local Usage` called the same research endpoint as `Run Campaign Research`, making three buttons perform one workflow. | Kept one `Run Campaign Research` button and clarified that it includes package verdicts, correlation, local usage, mitigation, and references. |
| Candidate routing | GitHub repositories were visually treated like package artifacts, causing CVE/VU leads to look like supply-chain campaigns. | Orchestrator output now displays package artifacts separately from project repositories, and GitHub-only vulnerability leads route to Vulnerability Tracking. |
| IOCs vs sources | Reporting domains, CVE reference URLs, and malformed HTML fragments appeared as IOCs/watchlist suggestions. | Source/reference domains remain references, malformed HTML URLs are rejected, and watchlist suggestions are based only on validated evidence. |
| Raw helper output | Raw CLI/helper JSON competed with operator-facing evidence. | Raw helper output remains available but is labeled as debug output and collapsed by default. |
| Blog Ops lifecycle | Publish and deploy semantics were easy to confuse. | Copy now says Publish stages approved drafts and Deploy moves staged drafts to Deployed after Cloudflare succeeds. |

## Current Button Map

| Button | Scope | Behavior |
| --- | --- | --- |
| Refresh evidence | Triage Ops | Read-only helper refresh for SCM findings and intel summary. |
| Run Discovery | Discovery Inbox | Fetch and score source/watchlist leads. |
| Run Autopilot Dry Run | Discovery Inbox | Preview orchestrator-approved package campaign research without writes. |
| Load Saved Candidates | Discovery Inbox | Reload cached campaign candidates. |
| Review Selected Lead | Discovery Inbox | Re-run deterministic Orchestrator Review for the selected candidate. |
| Use in Campaign Research | Discovery Inbox | Promote only candidates routed to Campaign Research with no blockers. |
| Add to Watchlist | Discovery Inbox | Token-gated save of validated package/publisher/IOC/source watch entries. |
| Run Campaign Research | Campaign Research | Read-only package verdicts, correlation, local usage, mitigation, and references. |
| Suggest Research Case | Campaign Research | Read-only route evaluation that explains whether a durable draft case is appropriate. |
| Create draft case | Research handoff | Protected action that creates only a `draft` case, seeds normalized subjects, and links the selected SCM finding when available. |
| Link existing case | Research handoff | Protected action that links the selected SCM finding to a chosen existing case. |
| Dismiss recommendation | Research handoff | Session-only UI dismissal; creates no case and changes no finding. |
| Persist Findings | Campaign Research | Token-gated SOC finding persistence after review. |
| Create Campaign Blog Draft | Campaign Research | Token-gated review-only draft creation. |
| Publish approved to blog | Blog Ops | Stage approved drafts into blog posts and feeds; drafts stay Approved. |
| Deploy blog to Cloudflare | Blog Ops | Deploy current blog output, then move staged approved drafts to Deployed after success. |

## Operator Rules

- Treat Autonomous Discovery as an inbox, not a write workflow.
- Use Campaign Research only after Orchestrator Review says the candidate is a
  package, extension, or supply-chain campaign.
- Keep CVE/VU-only, malware/APT, GitHub breach, and generic threat-intel leads
  out of package Campaign Research unless validated package evidence exists.
- Treat source/reporting domains as references, not attacker IOCs.
- Expand raw helper output only for debugging or CLI fallback evidence.
