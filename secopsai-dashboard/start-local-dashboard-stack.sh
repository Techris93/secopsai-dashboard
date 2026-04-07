#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${1:-45680}"
HOST="127.0.0.1"

cd "$DIR"

if [[ ! -f .env ]]; then
  echo "Missing $DIR/.env"
  echo "Create it from .env.example first:"
  echo "  cp .env.example .env"
  exit 1
fi

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [[ -n "${DASH_PID:-}" ]] && kill -0 "$DASH_PID" 2>/dev/null; then
    kill "$DASH_PID" 2>/dev/null || true
  fi
  wait "$DASH_PID" 2>/dev/null || true
  exit $code
}
trap cleanup EXIT INT TERM

echo "[secopsai-dashboard] Starting local stack on http://$HOST:$PORT"
"$DIR/serve-dashboard.sh" "$PORT" &
DASH_PID=$!

echo "[secopsai-dashboard] Dashboard PID: $DASH_PID"
echo "[secopsai-dashboard] Press Ctrl+C to stop"

while true; do
  if ! kill -0 "$DASH_PID" 2>/dev/null; then
    echo "[secopsai-dashboard] Dashboard server exited"
    break
  fi
  sleep 1
done
