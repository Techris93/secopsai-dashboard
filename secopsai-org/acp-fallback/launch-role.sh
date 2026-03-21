#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/chrixchange/.openclaw/workspace/secopsai-org/acp-fallback"
PROMPTS_DIR="$ROOT/prompts"
WORKSPACE="/Users/chrixchange/.openclaw/workspace"
AGENT_ID="${SECOPSAI_ACP_AGENT:-codex}"

usage() {
  cat <<'EOF'
Usage:
  secopsai-org/acp-fallback/launch-role.sh <department/role> <task...>

Example:
  secopsai-org/acp-fallback/launch-role.sh \
    platform/software-architect \
    "Propose a minimal orchestrator design for the first 12 roles"

Optional env:
  SECOPSAI_ACP_AGENT=codex|claude|gemini|opencode|pi|kimi
EOF
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" || $# -lt 2 ]]; then
  usage
  exit $([[ $# -lt 2 ]] && echo 1 || echo 0)
fi

ROLE="$1"
shift
TASK="$*"
PROMPT_FILE="$PROMPTS_DIR/${ROLE//\//__}.md"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Unknown role: $ROLE" >&2
  echo "Expected prompt file: $PROMPT_FILE" >&2
  exit 2
fi

TMP_PROMPT="$(mktemp)"
sed "s|{{TASK}}|$TASK|g" "$PROMPT_FILE" > "$TMP_PROMPT"

MESSAGE="$(cat "$TMP_PROMPT")"
rm -f "$TMP_PROMPT"

cat <<EOF
$MESSAGE
EOF

cat <<EOF

---
Launcher note:
- role: $ROLE
- preferred ACP agent: $AGENT_ID
- workspace: $WORKSPACE

Use the prompt above with an ACP one-shot run using:
- runtime: acp
- agentId: $AGENT_ID
- mode: run
- thread: false
EOF
