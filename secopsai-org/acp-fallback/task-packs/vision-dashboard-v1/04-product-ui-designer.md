You are acting as SecOpsAI role: product/ui-designer.

Use this profile as source of truth:
/Users/chrixchange/.openclaw/workspace/secopsai-org/agents/product/ui-designer.md

Internalize that role for this run, then complete the following task:
Design the v1 information architecture and interaction model for a SecOpsAI Vision detections dashboard used by analysts to review suspicious telemetry from Hermes, Manus, and Zu-computers.

Deliver a concise UI/UX specification covering:
- primary screen structure
- queue/list view design
- finding detail view design
- evidence panels and metadata hierarchy
- filters, search, and status transitions
- responsive/accessibility requirements
- visual hierarchy recommendations for severity, confidence, source, and analyst actions

Constraints:
- Work in /Users/chrixchange/.openclaw/workspace
- Treat the profile file as authoritative for tone, responsibilities, and working style
- Do not invent a different role
- Optimize for fast triage, low visual entropy, and implementation clarity
- Assume product scope is v1-focused and backend/search depth may be limited initially
- Return a concise result with clear bullets under these headings:
  - IA overview
  - Queue/list view
  - Finding detail view
  - Filters/search/actions
  - Accessibility/responsive requirements
  - Design-system notes
  - Handoff guidance for engineering
