# SecOpsAI ACP One-Shot Fallback

This folder provides a practical fallback for SecOpsAI role execution when persistent thread-bound sessions are unavailable in the current OpenClaw surface.

## Why this exists

The intended model in `../session-spawn-plan.md` uses persistent native subagent sessions with stable labels like `platform/software-architect`.

In the current webchat/control-ui context:
- persistent native subagent sessions are blocked because thread-bound subagent spawning hooks are unavailable
- persistent ACP sessions are blocked because thread bindings are unavailable for `webchat`
- ACP one-shot runs do work

So this fallback keeps the same role structure, labels, and source-of-truth profile files, but runs each role as an ACP one-shot task instead of a persistent thread-bound session.

## Files

- `runbook.md` — how to run any role as a one-shot ACP task
- `prompts/*.md` — one prompt wrapper per role

## Recommended harness

Default ACP harness:
- `agentId: codex`

You can swap to another allowed ACP agent later (for example `claude`, `gemini`, or `opencode`) if desired.

## Invocation pattern

Use `sessions_spawn` with:
- `runtime: "acp"`
- `agentId: "codex"`
- `mode: "run"`
- `thread: false`
- `cwd: "/Users/chrixchange/.openclaw/workspace"`

Then use the role prompt content as the `task`.

## Labels preserved logically

These one-shot runs do not create persistent thread-bound sessions, but they preserve the intended role identity in the prompt and output.

Starter roles covered:
- platform/software-architect
- platform/backend-architect
- platform/ai-engineer
- platform/devops-automator
- security/security-engineer
- security/threat-detection-engineer
- product/product-manager
- product/ui-designer
- revenue/content-creator
- revenue/outbound-strategist
- revenue/sales-engineer
- support/support-responder
