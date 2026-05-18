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

listener_pid() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

listener_cwd() {
  local pid="$1"
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true
}

listener_command() {
  local pid="$1"
  ps -p "$pid" -o command= 2>/dev/null || true
}

stop_owned_dashboard_listener() {
  local pid="$1"
  local cwd
  local command
  cwd="$(listener_cwd "$pid")"
  command="$(listener_command "$pid")"
  if [[ "$cwd" == "$DIR" && "$command" == *"dashboard_server.py"* ]]; then
    if [[ "${SECOPSAI_DASHBOARD_REPLACE_STALE_HELPER:-1}" != "1" ]]; then
      return 1
    fi
    echo "[secopsai-dashboard] Replacing stale local dashboard helper PID $pid on http://$HOST:$PORT"
    kill "$pid" 2>/dev/null || true
    for _ in {1..50}; do
      if ! kill -0 "$pid" 2>/dev/null; then
        return 0
      fi
      sleep 0.1
    done
    echo "[secopsai-dashboard] Stale helper did not exit; forcing stop for PID $pid"
    kill -9 "$pid" 2>/dev/null || true
    return 0
  fi
  return 1
}

if python3 - "$HOST" "$PORT" <<'PY'
import socket
import sys

host, port = sys.argv[1], int(sys.argv[2])
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.settimeout(0.25)
    raise SystemExit(0 if sock.connect_ex((host, port)) == 0 else 1)
PY
then
  existing_pid="$(listener_pid)"
  if [[ -n "$existing_pid" ]] && stop_owned_dashboard_listener "$existing_pid"; then
    :
  else
  echo "[secopsai-dashboard] A server is already listening on http://$HOST:$PORT"
  echo "[secopsai-dashboard] Open that URL, or stop the existing process before starting another:"
  echo "  lsof -nP -iTCP:$PORT -sTCP:LISTEN"
  echo "  kill <PID>"
  exit 0
  fi
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
