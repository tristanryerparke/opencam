#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INTEGRATION_ROOT="$(cd "$BRIDGE_ROOT/.." && pwd)"
PROJECT_ROOT="$(cd "$INTEGRATION_ROOT/../.." && pwd)"
CONTRACTS_ROOT="$PROJECT_ROOT/contracts"
PYTHON_ROOT="$INTEGRATION_ROOT/python"
WEB_ROOT="$INTEGRATION_ROOT"
INSTALL_DIR="${RHINO_MAC_PLUGINS_DIR:-$HOME/Library/Application Support/McNeel/Rhinoceros/8.0/MacPlugIns}/OpenCamRhinoBridge.rhp"

[[ -f "$INSTALL_DIR/development-python-root.txt" ]] || {
  echo "OpenCAM development bundle is not installed: $INSTALL_DIR" >&2
  exit 1
}

echo "Building OpenCAM WebView page..."
(cd "$WEB_ROOT" && bun run build)
mkdir -p "$INSTALL_DIR/web/dist"
cp -R "$WEB_ROOT/dist/." "$INSTALL_DIR/web/dist/"

echo "Refreshing shared OpenCAM contracts..."
mkdir -p "$PYTHON_ROOT/site-packages"
uv pip install --python 3.9 --target "$PYTHON_ROOT/site-packages" "$CONTRACTS_ROOT"

echo "Reloading OpenCAM source in Rhino..."
cd "$PROJECT_ROOT"
uv run rhino-watch "$SCRIPT_DIR/reload-development.py"
