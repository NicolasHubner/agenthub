#!/usr/bin/env bash
# Build the agenthub server + UI, then build the desktop app bundle (AppImage/.deb).
set -e
cd "$(dirname "$0")"
cargo build --release --bin agenthub
mkdir -p src-tauri/resources
cp target/release/agenthub src-tauri/resources/agenthub
(cd ui && npm run build)
(cd src-tauri && cargo tauri build)
