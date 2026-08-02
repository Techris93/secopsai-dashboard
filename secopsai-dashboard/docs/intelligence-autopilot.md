# Autonomous triage

Open **Automation → SecOpsAI Intelligence** to choose a Kimi, Grok, Gemini, or Codex model from the local OpenCodex catalog. The same panel controls continuous review of canonical SecOpsAI findings.

## Modes

- **Off** creates no automatic model jobs.
- **Advisory only** records the model verdict, evidence references, counterarguments, and next action without changing the finding.
- **Guarded automation** may close a finding only when deterministic SecOpsAI analysis independently supports the same benign disposition. It may place a corroborated true positive in review. Every mutation stores the previous state and exposes **Rollback**.

Use **Save automation policy** after selecting the mode, model, minimum confidence, evidence-reference count, and cycle limit. **Review new findings now** queues all eligible changed findings immediately. The running local bridge performs the model work continuously after that.

## Rule tuning

Model proposals are never treated as proof. SecOpsAI records them in shadow mode and evaluates them against reviewed historical findings. Automatic activation is limited to an exact ecosystem-threshold recommendation that matches high-confidence deterministic replay with enough safe and risky examples. Rule weights, logic conditions, and exceptions remain shadow-only.

## Daily workflow automation

Use **Administration → Automation → Daily workflow automation** for the full
scheduled workflow. Save the policy once, then use **Run full workflow now** to
perform the first cycle. Later cycles are started by the existing research
worker when the configured interval is due.

The cycle runs these steps in order and shows each result in the latest-cycle
table:

1. Registry surveillance and bounded recovery.
2. Deterministic candidate promotion into draft cases.
3. Alert feedback capture and model-review queueing.
4. Evidence investigations for eligible high-priority findings.
5. Guarded detection-learning replay and tuning proposals.
6. Operational alert delivery.

Set **Automation** to **Enabled**, choose an interval, and set limits that fit
the available worker and model quota. **Create draft cases from policy-approved
candidates** is safe because it creates reviewable drafts only. **Run guarded
detection learning** keeps every alert in the feedback ledger while blocking
unproven detector changes.

The latest cycle is marked `succeeded` when all steps finish, or `degraded` when
one or more steps fail. A degraded cycle still completes later steps and keeps
the failed step and its error in the audit record for recovery. The coordinator
prevents overlapping cycles and schedules the next attempt automatically.

## Authority boundary

Autonomous triage cannot publish research, send disclosure, submit an artifact to a sandbox, execute package code, run a network scan, or perform destructive response. Missing local dependency exposure never proves that a package is benign. Final publication approval remains an operator decision.
