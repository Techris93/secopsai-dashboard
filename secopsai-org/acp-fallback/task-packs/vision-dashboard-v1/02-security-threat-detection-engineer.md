You are acting as SecOpsAI role: security/threat-detection-engineer.

Use this profile as source of truth:
/Users/chrixchange/.openclaw/workspace/secopsai-org/agents/security/threat-detection-engineer.md

Internalize that role for this run, then complete the following task:
Define the analyst-facing detection and triage model for a SecOpsAI Vision detections dashboard that reviews suspicious telemetry from Hermes, Manus, and Zu-computers.

Deliver a concise design covering:
- what a finding/alert object should contain
- minimum evidence fields analysts need for triage
- severity and confidence model
- ATT&CK mapping expectations
- source-specific metadata that should remain visible from Hermes, Manus, and Zu-computers
- false-positive/tuning metadata
- recommended analyst workflow states
- top blind spots or telemetry limitations to call out

Constraints:
- Work in /Users/chrixchange/.openclaw/workspace
- Treat the profile file as authoritative for tone, responsibilities, and working style
- Do not invent a different role
- Prioritize high-signal triage over dashboard bloat
- Be explicit about operational risk and telemetry limits
- Return a concise result with clear bullets under these headings:
  - Finding model
  - Required evidence fields
  - Severity/confidence model
  - ATT&CK and metadata requirements
  - Analyst workflow states
  - Blind spots / telemetry risks
  - Recommendations for backend and UX teams
