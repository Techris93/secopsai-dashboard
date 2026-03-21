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

python3 "$DIR/generate-config.py"

echo "Serving SecOpsAI dashboard from: $DIR"
echo "URL: http://$HOST:$PORT"
echo "Loaded config from: $DIR/.env"
python3 -m http.server "$PORT" --bind "$HOST"
