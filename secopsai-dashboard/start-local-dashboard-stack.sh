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

if python3 - "$HOST" "$PORT" <<'PY'
import socket
import sys

host, port = sys.argv[1], int(sys.argv[2])
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.settimeout(0.25)
    raise SystemExit(0 if sock.connect_ex((host, port)) == 0 else 1)
PY
then
  echo "[secopsai-dashboard] A server is already listening on http://$HOST:$PORT"
  echo "[secopsai-dashboard] Open that URL, or stop the existing process before starting another:"
  echo "  lsof -nP -iTCP:$PORT -sTCP:LISTEN"
  echo "  kill <PID>"
  exit 0
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
