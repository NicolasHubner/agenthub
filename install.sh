#!/usr/bin/env bash
# AgentHub one-line installer (Debian/Ubuntu).
#   curl -fsSL https://raw.githubusercontent.com/NicolasHubner/agenthub/main/install.sh | bash
set -euo pipefail

REPO="NicolasHubner/agenthub"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> AgentHub installer"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "!! This installer supports Debian/Ubuntu (apt) only." >&2
  echo "   Use the .AppImage from https://github.com/$REPO/releases instead." >&2
  exit 1
fi

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

echo "==> Installing runtime dependencies (tmux + webkit)…"
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq \
  tmux \
  libwebkit2gtk-4.1-0 \
  libgtk-3-0 \
  libayatana-appindicator3-1 \
  curl

echo "==> Fetching latest AgentHub .deb…"
DEB_URL="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -oE '"browser_download_url": *"[^"]+_amd64\.deb"' \
  | head -1 | cut -d'"' -f4)"

if [ -z "${DEB_URL:-}" ]; then
  echo "!! No .deb asset found in the latest release." >&2
  exit 1
fi

echo "    $DEB_URL"
curl -fsSL -o "$TMP/agenthub.deb" "$DEB_URL"

echo "==> Installing AgentHub…"
$SUDO apt-get install -y "$TMP/agenthub.deb"

echo "==> Done. Launch it from your app menu or run: agenthub"
