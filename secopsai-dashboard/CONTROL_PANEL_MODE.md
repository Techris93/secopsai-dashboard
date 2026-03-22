# SecOpsAI Dashboard: Control-Panel-Only Mode

The dashboard is now a control panel, not a conversation runtime.

## What the dashboard does
- read/write Supabase state
- manage tasks, artifacts, and audit events
- show channel-route metadata
- send optional audit notifications through configured webhooks
- generate copyable work briefs

## What the dashboard no longer does
- poll Discord for inbound conversations
- send direct bot messages to agent channels
- act as the execution/runtime authority for role dispatch

## Runtime split
- **OpenClaw-native orchestrator** handles inbound conversations, routing, session spawning, and replies
- **Dashboard** handles observability, human control, and structured state updates

## Current implication
- `discord_dispatcher.py` is retired from the intended path
- `start-discord-dispatcher.sh` intentionally exits with a retirement message
- `/api/discord-send-message` returns HTTP 410 Gone

## Recommended usage
1. Use the dashboard to create or update a work item
2. Assign an owner role and reviewer if needed
3. Copy the generated work brief
4. Hand it to the OpenClaw-native orchestrator or an ACP run
5. Let OpenClaw own the actual conversation and delivery
