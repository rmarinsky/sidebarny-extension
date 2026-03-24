#!/usr/bin/env bash
set -euo pipefail

# Local-only: builds the zip for manual testing/upload.
# Releases are created automatically by CI when version changes in manifest.json.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VERSION=$(jq -r '.version' manifest.json)
ZIP_NAME="sidebarny-llm-${VERSION}.zip"
DIST_DIR="dist"

echo "==> SideBarny LLM ${VERSION}"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

zip -r "${DIST_DIR}/${ZIP_NAME}" \
  manifest.json \
  rules.json \
  background.js \
  sidepanel.html \
  sidepanel.css \
  sidepanel.js \
  content.js \
  chat-input-injector.js \
  opensearch-dashboard-parser.js \
  icons/ \
  -x "*.DS_Store"

echo "==> Created ${DIST_DIR}/${ZIP_NAME}"
