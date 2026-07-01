#!/usr/bin/env bash
# Build the desktop bundles and publish/update a GitHub Release with them.
# Usage: ./release.sh [version]     e.g. ./release.sh 0.1.1
#   - No arg  -> reuses the version in src-tauri/tauri.conf.json (updates that tag).
#   - Version -> bumps tauri.conf.json + Cargo.toml, commits, then releases.
set -euo pipefail
cd "$(dirname "$0")"

CONF="src-tauri/tauri.conf.json"
CUR="$(grep -oE '"version": *"[0-9]+\.[0-9]+\.[0-9]+"' "$CONF" | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
VERSION="${1:-$CUR}"

if [ "$VERSION" != "$CUR" ]; then
  echo "==> Bumping version $CUR -> $VERSION"
  sed -i -E "s/(\"version\": *\")$CUR(\")/\1$VERSION\2/" "$CONF"
  sed -i -E "s/^version = \"$CUR\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
  git add "$CONF" src-tauri/Cargo.toml
  git commit -q -m "chore: release v$VERSION"
  git push -q origin main
fi

TAG="v$VERSION"

echo "==> Building bundles…"
./desktop.sh

DEB="src-tauri/target/release/bundle/deb/AgentHub_${VERSION}_amd64.deb"
APPIMAGE="src-tauri/target/release/bundle/appimage/AgentHub_${VERSION}_amd64.AppImage"
[ -f "$DEB" ] || { echo "!! Missing $DEB" >&2; exit 1; }
[ -f "$APPIMAGE" ] || { echo "!! Missing $APPIMAGE" >&2; exit 1; }

NOTES="Instalação em uma linha (Ubuntu/Debian):

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/NicolasHubner/agenthub/main/install.sh | bash
\`\`\`

Ou baixe o \`.AppImage\` (portátil: \`chmod +x\` e rode)."

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "==> Updating existing release $TAG…"
  gh release upload "$TAG" "$DEB" "$APPIMAGE" --clobber
  gh release edit "$TAG" --notes "$NOTES"
else
  echo "==> Creating release $TAG…"
  gh release create "$TAG" "$DEB" "$APPIMAGE" --title "AgentHub $TAG" --notes "$NOTES"
fi

echo "==> Released $TAG: https://github.com/NicolasHubner/agenthub/releases/tag/$TAG"
