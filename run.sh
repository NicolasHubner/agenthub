#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

UI="$ROOT/ui"

if [[ ! -d "$UI/node_modules" ]]; then
  echo "→ npm install (ui)"
  npm --prefix "$UI" install
fi

if [[ ! -f "$UI/dist/index.html" ]] || [[ "${AGENTHUB_REBUILD_UI:-}" == "1" ]]; then
  echo "→ npm run build (ui)"
  npm --prefix "$UI" run build
fi

export AGENTHUB_WORKSPACE="${AGENTHUB_WORKSPACE:-$ROOT}"
export AGENTHUB_UI_DIR="${AGENTHUB_UI_DIR:-$UI/dist}"
export AGENTHUB_PORT="${AGENTHUB_PORT:-3000}"

echo "→ http://127.0.0.1:${AGENTHUB_PORT}"
echo "→ workspace ${AGENTHUB_WORKSPACE}"

exec cargo build --manifest-path "$ROOT/Cargo.toml" --bins -q
exec cargo run --manifest-path "$ROOT/Cargo.toml" --bin agenthub
