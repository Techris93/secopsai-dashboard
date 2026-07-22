# SecOpsAI Research Operator Runbook

This is the practical path from a research lead to a reviewed article on
`blog.secopsai.dev`. It describes the current product boundaries and the
actions that remain human-controlled.

## The Three Research Stages

| Surface | Use it for | Typical record |
| --- | --- | --- |
| Supply Chain Triage | Review an incoming SecOpsAI supply-chain alert and decide what it means operationally. | `SCM-*` finding |
| Research | Preserve an independent investigation with subjects, evidence, IOCs, disclosure, and reproducible exports. | `RSC-*` case |
| Blog Ops | Edit, approve, publish, rebuild feeds, and deploy a reviewed article. | Blog draft |

These are not duplicate queues. Supply Chain Triage can produce a research
lead. Research Cases are the source of truth for an original investigation.
Blog Ops is the editorial and deployment boundary.

## Start A Research Case

### A. Start from an alert

1. Sign in to the dashboard.
2. Open **Supply Chain Triage** and click **Refresh evidence**.
3. Select an `SCM-*` alert.
4. Run **Run Evidence Verdict** first.
5. Run **Investigate**, **Explain verdict**, **Check advisory matches**, and
   **Check local repo usage** when the evidence needs more context.
6. Read the distinction between package verdict and environment impact. A
   package can be malicious even when this repository does not use it.
7. Use the alert's **Create blog draft** only for a short, reviewed alert
   handoff. For serious original research, create or link a Research Case.

### B. Start from a package watchlist

1. Open **Research**.
2. Use **Research discovery** to select npm, PyPI, NuGet, Maven, RubyGems,
   Packagist, Go, or Open VSX.
3. Add a package, brand, publisher, namespace, repository, or organization
   watchlist and create the appropriate scoped monitor.
4. Review a scored candidate. Coverage labels explain whether the result came
   from a scoped watchlist or a broader registry collector.
5. Promote the candidate only after checking its explainable score, registry
   provenance, and reference package.
6. Create or open the resulting draft case.

### C. Start manually

1. Open **Research** and click **New case**.
2. Use a specific title, such as `NuGet payment SDK typosquat investigation`.
3. Select the case type, severity, confidence, owner, and a short summary.
4. Click **Create case**.

Use manual creation for public reports, malware, typosquatting, dependency
confusion, infrastructure clustering, vulnerability research, and any case
that did not begin as an `SCM-*` alert.

## Run The Investigation Pipeline

1. Open the case and verify its active package subject.
2. Enter a legitimate comparison package only when you have verified that it
   is the correct reference. SecOpsAI does not infer brand ownership.
3. Click **Run Investigation Pipeline**.
4. Wait while Core performs safe static intake and the Local Codex Bridge
   analyzes minimized context. The page refreshes automatically.
5. Review every proposal. Edit inaccurate wording, then click **Accept** or
   **Reject**. Static evidence is attached only after acceptance.
6. If the bridge fails, click **Retry from checkpoint**. If the reference was
   missing, enter it and click **Add reference and rerun analysis**.
7. Continue to the human verdict, sandbox, disclosure, and publication gates.

The bridge never receives the quarantined package artifact or local path. It
receives normalized metadata, hashes, manifests, static indicators, comparison
results, and the current evidence matrix.

## Build Or Extend The Evidence Record

Open the case and use the action drawers in this order:

1. **Add subject**: record each package, extension, publisher, repository,
   brand, or infrastructure item. Include ecosystem, version, and publisher
   when known.
2. **Add evidence**: record public URLs, registry metadata, local artifact
   hashes, static-analysis notes, screenshots, sandbox results, and analyst
   notes. Every important claim should have provenance.
3. **Add IOC**: record only indicators supported by evidence. Link each IOC to
   its source evidence and set a confidence value.
4. **Add detection rule**: attach YARA, Sigma, or Semgrep content when it gives
   readers or customers a useful defensive test. Rules are structurally
   validated and are never executed by SecOpsAI.
5. **Save workflow**: update the case status, disclosure status, confidence,
   severity, owner, and summary.

For every artifact, preserve the source, collection time, SHA-256 when useful,
tool/version, and analysis limitations. If a record is wrong, use **Retract**
with a reason; do not hide the correction by deleting history.

## Safe Analysis Boundary

Automated or safe-by-default work:

- watchlist loading and preview
- deterministic case creation and idempotence checks
- case readiness validation
- report export and manifest checksums
- structured IOC and detection-rule storage
- read-only alert evidence and campaign correlation
- draft generation after readiness gates pass

Human-controlled work:

- deciding whether a lead is worth investigating
- confirming that a package, publisher, or IOC is real
- interpreting static-analysis results
- approving any dynamic analysis
- choosing disclosure recipients and timing
- deciding whether a claim is publishable
- approving and publishing public content

Never run an untrusted package on the MacBook. Use a disposable, isolated,
network-controlled sandbox for dynamic analysis, with no production secrets,
customer data, or access to third-party systems. Static analysis is the
default. LLM output is a drafting aid, never evidence.

## Make A Case Publishable

The case readiness gate requires:

- clear title and substantial executive summary
- at least one active structured subject
- at least two active evidence records
- at least one public source or registry locator
- confidence of 60 or higher
- disclosure completed or explicitly marked not required
- status `Ready to publish`
- every active detection rule structurally validates

Before changing the status:

1. Re-check the affected package or artifact against the legitimate project.
2. Confirm the timeline and the exact affected versions.
3. Separate observed behavior from inference.
4. Record what you did not prove.
5. Complete or document responsible disclosure.
6. Add mitigation and detection guidance for readers.

## Export And Publish

1. In the case detail, click **Download case report**.
2. Review the Markdown and JSON content and its manifest checksums.
3. When the case is `Ready to publish`, click **Create review draft**.
4. Open **Blog Ops** and refresh the draft queue.
5. Review the title, summary, severity, body, references, IOCs, affected
   artifacts, detection logic, mitigations, and limitations.
6. Edit and save any corrections. Do not paste internal paths, secrets,
   customer identifiers, or copied article text into the public draft.
7. Complete disclosure review.
8. Click **Approve** only when the article is accurate and publishable.
9. Click **Publish approved**. Rebuild feeds when prompted.
10. Click **Deploy blog** or use the configured GitHub Actions/Cloudflare
    deployment path.
11. Return to Research, set the case to **Published**, and preserve the
    exported report and manifest.

Publishing is never automatic from an alert, watchlist hit, campaign result,
or AI-generated summary.

## Socket-Style Research Shape

For a package investigation, structure the article around:

1. Executive summary and affected versions.
2. Legitimate package comparison.
3. Timeline and publication/publisher history.
4. Static evidence and relevant execution paths.
5. Why the behavior matters and who is exposed.
6. IOCs and detection rules.
7. Mitigation, cleanup, and upgrade guidance.
8. Disclosure timeline and references.
9. Confidence, limitations, and what remains unknown.

Do not publish exploit instructions, stolen secrets, or operational details
that would increase harm. Defang indicators in public prose where appropriate,
while keeping the internal case record precise and access-controlled.

## Credential Guide

There is no shared administrator password to retrieve from this repository.
Production credentials are deployment secrets and must never be printed in
logs, committed, or pasted into chat.

### Dashboard operator account

The canonical hosted dashboard uses Supabase Auth. An existing workspace owner
invites a user from Settings or Supabase Auth administration. The invited user
chooses their own password from the one-time link. Existing users use
**Send password reset** on the sign-in screen. Enable MFA and store recovery
codes outside the dashboard.

### Research and Supply Chain Triage actions

The helper and hosted Worker use `TRIAGE_OPS_ADMIN_TOKEN` for protected writes.
`BLOG_OPS_ADMIN_TOKEN` is the documented fallback when the same operator secret
is intentionally shared. Generate a new value locally with:

```bash
openssl rand -hex 32
```

Configure it as a server-side helper environment variable and/or Cloudflare
secret. Paste it into the dashboard only when performing a protected action;
the browser keeps it in session storage and clears it when the session is
cleared.

### Edge API and sensor credentials

`SECOPSAI_ADMIN_TOKEN` is the Edge API administrator secret for enrollment and
recovery. It is not a dashboard password and should not be pasted into the
Research token field. Normal sensor setup should use a short-lived enrollment
token or a scoped sensor token.

Values in `.env.example` such as `dev-admin-token` and
`change-me-before-pilot` are development placeholders only. Replace them
before any hosted or customer deployment.

## Recovery Checklist

1. Lost dashboard password: request a reset link or ask another owner to
   invite a replacement account.
2. Lost research action token: generate a replacement, update the helper and
   Worker, test a harmless read/preview, then revoke the old value.
3. Lost sensor token: rotate or re-enroll the sensor from Edge Settings and
   restart the worker with the new token.
4. Do not delete the last owner account. Keep two owner accounts and test both
   recovery paths before a pilot.
