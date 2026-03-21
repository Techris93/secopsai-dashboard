#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${1:-45680}"
HOST="127.0.0.1"

cd "$DIR"
echo "Serving SecOpsAI dashboard from: $DIR"
echo "URL: http://$HOST:$PORT"
python3 -m http.server "$PORT" --bind "$HOST"
