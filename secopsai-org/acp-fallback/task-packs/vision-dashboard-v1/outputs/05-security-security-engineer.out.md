# Security Engineer Output

## Trust boundaries
- Telemetry arriving from Hermes, Manus, and Zu-computers is untrusted input at ingest boundaries
- Normalization and finding generation are trust-transition points and must be validated/logged
- Analyst-facing dashboard views may expose sensitive operational details and must be access-controlled
- External website messaging is a separate trust boundary from product behavior and must not overstate system capability

## Data handling / privacy
- Minimize exposure of sensitive identifiers where not needed for triage
- Treat host/user/process/network/file data as potentially sensitive operational data
- Ensure evidence views do not accidentally surface secrets, tokens, or unnecessary personal data
- Log access to sensitive finding detail views where practical

## Access control / audit requirements
- Role-based access for analyst workflows
- Least privilege for viewing detailed evidence
- Auditability for status changes, notes, and sensitive finding review
- Clear separation between read access and administrative configuration actions

## Approved claim patterns
- “Helps analysts review suspicious telemetry across integrated sources.”
- “Surfaces findings with supporting evidence and triage context.”
- “Improves analyst workflow by organizing suspicious activity for review.”
- “Provides visibility into suspicious telemetry from integrated systems.”

## Prohibited claim patterns
- “Stops attacks automatically.”
- “Guarantees malware detection.”
- “Eliminates false positives.”
- “Provides complete coverage.”
- “Prevents all exfiltration.”
- Any unsupported claim about detection accuracy, autonomy, or comprehensive prevention

## Top risks
- Overclaiming detection efficacy in launch materials
- Leaking sensitive telemetry or identifiers through overly verbose evidence views
- Weak authorization around analyst workflows
- Trust erosion if low-confidence findings are presented without rationale

## Remediation / launch gates
- Security sign-off required for all external launch copy
- Explicit data exposure review before shipping evidence panels
- Access control and audit trail requirements should be satisfied before broad rollout
- Product copy must distinguish suspicious activity review from guaranteed threat prevention
