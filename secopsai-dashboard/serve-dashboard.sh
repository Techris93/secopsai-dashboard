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

repo_identity() {
  local path="$1"
  git -C "$path" config --get remote.origin.url 2>/dev/null \
    | sed -E 's#^git@github.com:#https://github.com/#; s#\.git$##' \
    | head -n 1 || true
}

is_related_dashboard_checkout() {
  local cwd="$1"
  local command="$2"
  local current_repo
  local listener_repo
  [[ "$command" == *"dashboard_server.py"* ]] || return 1
  current_repo="$(repo_identity "$DIR")"
  listener_repo="$(repo_identity "$cwd")"
  [[ -n "$current_repo" && "$listener_repo" == "$current_repo" ]]
}

stop_owned_dashboard_listener() {
  local pid="$1"
  local cwd
  local command
  cwd="$(listener_cwd "$pid")"
  command="$(listener_command "$pid")"
  if [[ "$cwd" == "$DIR" && "$command" == *"dashboard_server.py"* ]] \
    || { [[ "${SECOPSAI_DASHBOARD_REPLACE_OTHER_CHECKOUT:-1}" == "1" ]] && is_related_dashboard_checkout "$cwd" "$command"; }; then
    if [[ "${SECOPSAI_DASHBOARD_REPLACE_STALE_HELPER:-1}" != "1" ]]; then
      return 1
    fi
    if [[ "$cwd" != "$DIR" ]]; then
      echo "Replacing dashboard from another checkout: $cwd"
      echo "Canonical checkout: $DIR"
    fi
    echo "Replacing stale local dashboard helper PID $pid on http://$HOST:$PORT"
    kill "$pid" 2>/dev/null || true
    for _ in {1..50}; do
      if ! kill -0 "$pid" 2>/dev/null; then
        return 0
      fi
      sleep 0.1
    done
    echo "Stale helper did not exit; forcing stop for PID $pid"
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
  echo "Port $PORT is already in use on $HOST."
  echo "Open http://$HOST:$PORT if the dashboard is already running, or stop the listener:"
  echo "  lsof -nP -iTCP:$PORT -sTCP:LISTEN"
  echo "  kill <PID>"
  exit 2
  fi
fi

set -a
source "$DIR/.env"
set +a

python3 "$DIR/generate-config.py"

export PORT HOST
exec python3 "$DIR/dashboard_server.py"
