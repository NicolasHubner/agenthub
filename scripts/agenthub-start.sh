#!/usr/bin/env bash
# Launch AgentHub on this machine: build if needed, serve the PWA + backend,
# then open the browser. Works on Linux and macOS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${AGENTHUB_PORT:-3000}"
BIN="$ROOT/target/release/agenthub"
UI="$ROOT/ui/dist"
URL="http://127.0.0.1:$PORT"

if [ ! -f "$UI/index.html" ]; then
  echo "agenthub: building UI…"
  (cd "$ROOT/ui" && npm install && npm run build)
fi

if [ ! -x "$BIN" ]; then
  echo "agenthub: building backend…"
  (cd "$ROOT" && cargo build --release --bin agenthub)
fi

export AGENTHUB_UI_DIR="$UI"
export AGENTHUB_PORT="$PORT"
export AGENTHUB_WORKSPACE="${AGENTHUB_WORKSPACE:-$PWD}"

"$BIN" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

# Wait for the server to accept connections, then open the browser.
for _ in $(seq 1 50); do
  if curl -sf "$URL" >/dev/null 2>&1; then break; fi
  sleep 0.2
done

case "$(uname -s)" in
  Darwin) open "$URL" ;;
  Linux) xdg-open "$URL" >/dev/null 2>&1 || true ;;
esac

echo "agenthub: $URL (Ctrl-C to stop)"
wait "$SERVER_PID"
