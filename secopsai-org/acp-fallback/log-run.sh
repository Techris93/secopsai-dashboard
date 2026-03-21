#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: secopsai-org/acp-fallback/log-run.sh <payload.json>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
python3 "$SCRIPT_DIR/log-run.py" "$1"
