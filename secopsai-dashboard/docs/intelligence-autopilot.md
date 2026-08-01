# Autonomous triage

Open **Automation → SecOpsAI Intelligence** to choose a Kimi, Grok, Gemini, or Codex model from the local OpenCodex catalog. The same panel controls continuous review of canonical SecOpsAI findings.

## Modes

- **Off** creates no automatic model jobs.
- **Advisory only** records the model verdict, evidence references, counterarguments, and next action without changing the finding.
- **Guarded automation** may close a finding only when deterministic SecOpsAI analysis independently supports the same benign disposition. It may place a corroborated true positive in review. Every mutation stores the previous state and exposes **Rollback**.

Use **Save automation policy** after selecting the mode, model, minimum confidence, evidence-reference count, and cycle limit. **Review new findings now** queues all eligible changed findings immediately. The running local bridge performs the model work continuously after that.

## Rule tuning

Model proposals are never treated as proof. SecOpsAI records them in shadow mode and evaluates them against reviewed historical findings. Automatic activation is limited to an exact ecosystem-threshold recommendation that matches high-confidence deterministic replay with enough safe and risky examples. Rule weights, logic conditions, and exceptions remain shadow-only.

## Authority boundary

Autonomous triage cannot publish research, send disclosure, submit an artifact to a sandbox, execute package code, run a network scan, or perform destructive response. Missing local dependency exposure never proves that a package is benign. Final publication approval remains an operator decision.
