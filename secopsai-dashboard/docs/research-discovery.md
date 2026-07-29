# Research Discovery Console

The Research page is the operator surface for Core-owned registry monitoring. It supports eight ecosystems: npm, PyPI, NuGet, Maven, RubyGems, Packagist, Go, and Open VSX.

Use the **Research discovery** panel to add a package, brand, publisher, namespace, repository, or organization watchlist. Refresh the panel, select the resulting watchlist, and create a monitor with a 15-minute, hourly, or daily interval. **Run due monitors** triggers only due work; it does not perform a broad registry scan.

Coverage is displayed from Core’s capability registry. A watchlist-scoped monitor is deliberately shown as incomplete coverage. No empty candidate list should be interpreted as proof that a registry is clean.

For a case, **Run Safe Package Intake** fetches and hashes an artifact into quarantine for bounded static analysis. **Compare packages** performs the same safe collection for two exact targets and stores a normalized comparison. Neither action installs or executes package code.

Sandbox, disclosure, and publication actions remain approval-gated. The browser never receives provider tokens. Tria.ge public submission requires a visible acknowledgement and should be used only for artifacts that are authorized for public analysis.

## Candidate promotion policy

The Discovery Inbox can apply a durable promotion policy after candidates are scored. The policy is disabled by default and supports an ecosystem scope, minimum similarity score, minimum evidence-reference count, optional publisher evidence, and one of two modes: review only or draft-case creation.

Always preview the policy before applying it. Applying the policy creates an auditable draft Research Case only. It does not label a package malicious, approve a disclosure, submit an artifact, or publish content. Each created case retains the candidate ID, policy values, evidence provenance, actor, and promotion event.

Campaign correlation has its own route. Campaign relationships are deterministic and evidence-linked; shared infrastructure alone does not establish common ownership or attribution.
