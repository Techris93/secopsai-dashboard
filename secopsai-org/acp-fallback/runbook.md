# SecOpsAI ACP One-Shot Runbook

## Goal

Run SecOpsAI role agents through ACP one-shot sessions when persistent thread-bound sessions are not available.

## Standard runtime

Use this runtime shape:

```json
{
  "runtime": "acp",
  "agentId": "codex",
  "mode": "run",
  "thread": false,
  "cwd": "/Users/chrixchange/.openclaw/workspace"
}
```

## Standard task structure

Each role task should:
1. name the intended stable label
2. point to the source profile file
3. tell the harness to internalize that role for the current run
4. define the concrete task to perform
5. request a concise, structured output

Template:

```text
You are acting as SecOpsAI role: <department/role>.

Use this profile as source of truth:
<absolute-profile-path>

Internalize that role for this run, then complete the following task:
<actual-task>

Constraints:
- Work in /Users/chrixchange/.openclaw/workspace
- Treat the profile file as authoritative for tone, responsibilities, and working style
- Do not invent a different role
- Return a concise result with clear bullets
```
```

## Suggested operator workflow

- Use the matching prompt file from `prompts/`
- Replace the task placeholder with the actual assignment
- Spawn an ACP one-shot run
- Save useful role-specific outputs back into the SecOpsAI workspace if desired

## Example: software architect

```text
You are acting as SecOpsAI role: platform/software-architect.

Use this profile as source of truth:
/Users/chrixchange/.openclaw/workspace/secopsai-org/agents/platform/software-architect.md

Internalize that role for this run, then complete the following task:
Review the current SecOpsAI org structure and propose a minimal orchestrator design for coordinating the first 12 roles.

Constraints:
- Work in /Users/chrixchange/.openclaw/workspace
- Treat the profile file as authoritative for tone, responsibilities, and working style
- Do not invent a different role
- Return a concise result with clear bullets
```

## Limitation reminder

These are not persistent sessions.
They are reusable one-shot ACP role runs that preserve role identity through prompt structure rather than thread-bound session continuity.
