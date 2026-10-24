#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INTEGRATION_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
PROJECT_ROOT="$(cd "$INTEGRATION_ROOT/../.." && pwd)"
CONTRACTS_ROOT="$PROJECT_ROOT/contracts"
RHINOCODE="${RHINOCODE:-/Applications/Rhino 8.app/Contents/Resources/bin/rhinocode}"
RHINO_PROJECT="$REPO_ROOT/opencam-rhino-bridge.rhproj"
GENERATED_ROOT="$REPO_ROOT/build/rh8"
GENERATED_PROJECT="$GENERATED_ROOT/src/OpenCam/OpenCam.csproj"
GENERATED_PLUGIN="$GENERATED_ROOT/OpenCam.rhp"
PROJECT_DATA_EXTRACTOR="$REPO_ROOT/utilities/ProjectDataExtractor/ProjectDataExtractor.csproj"
PYTHON_ROOT="$INTEGRATION_ROOT/python"
WEB_ROOT="$INTEGRATION_ROOT"
PLUGIN_NAME="OpenCam"
MAC_PLUGINS_DIR="${RHINO_MAC_PLUGINS_DIR:-$HOME/Library/Application Support/McNeel/Rhinoceros/8.0/MacPlugIns}"
INSTALL_DIR="$MAC_PLUGINS_DIR/$PLUGIN_NAME.rhp"
MODE="development"
CONFIGURATION=""

usage() {
  cat <<'EOF'
Usage: scripts/build-install-mac.sh [--mode development|production] [--configuration Debug|Release]

Builds the generated RhinoCode project plus OpenCAM's C# WebView bridge.
Development mode imports OpenCAM Python directly from this checkout.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --configuration) CONFIGURATION="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ "$MODE" == development || "$MODE" == production ]] || { echo "Mode must be development or production." >&2; exit 2; }
[[ -x "$RHINOCODE" ]] || { echo "RhinoCode CLI missing: $RHINOCODE" >&2; exit 1; }
[[ -d "$PYTHON_ROOT/opencam_rhino" ]] || { echo "OpenCAM Python missing: $PYTHON_ROOT/opencam_rhino" >&2; exit 1; }
[[ -f "$CONTRACTS_ROOT/pyproject.toml" ]] || { echo "OpenCAM contracts missing: $CONTRACTS_ROOT" >&2; exit 1; }
[[ -f "$WEB_ROOT/index.html" ]] || { echo "OpenCAM WebView source missing: $WEB_ROOT/index.html" >&2; exit 1; }
CONFIGURATION="${CONFIGURATION:-$([[ "$MODE" == development ]] && echo Debug || echo Release)}"

rm -rf "$GENERATED_ROOT"
echo "Generating RhinoCode host..."
"$RHINOCODE" project build "$RHINO_PROJECT" --buildpath "$REPO_ROOT/build" --buildtarget '8.*'
dotnet run --project "$PROJECT_DATA_EXTRACTOR" -- "$GENERATED_PLUGIN" "$(dirname "$GENERATED_PROJECT")/Plugin.Data.resources"
python3 "$SCRIPT_DIR/prepare-script-plugin.py"

echo "Building self-contained WebView page..."
(cd "$WEB_ROOT" && bun run build)
[[ -f "$WEB_ROOT/dist/index.html" ]] || { echo "OpenCAM WebView build did not create dist/index.html." >&2; exit 1; }

echo "Building $PLUGIN_NAME ($CONFIGURATION)..."
dotnet build "$GENERATED_PROJECT" -c "$CONFIGURATION"
PLUGIN_FILE="$GENERATED_ROOT/src/OpenCam/bin/$CONFIGURATION/net48/$PLUGIN_NAME.rhp"
[[ -f "$PLUGIN_FILE" ]] || { echo "Build succeeded but plug-in missing: $PLUGIN_FILE" >&2; exit 1; }

rm -rf "$INSTALL_DIR" "$MAC_PLUGINS_DIR/OpenCamRhinoBridge.rhp"
mkdir -p "$INSTALL_DIR/web"
cp "$PLUGIN_FILE" "$INSTALL_DIR/"
cp -R "$WEB_ROOT/dist" "$INSTALL_DIR/web/"
if [[ "$MODE" == development ]]; then
  mkdir -p "$PYTHON_ROOT/site-packages"
  uv pip install --python 3.9 --target "$PYTHON_ROOT/site-packages" "$CONTRACTS_ROOT"
  printf '%s\n' "$PYTHON_ROOT" > "$INSTALL_DIR/development-python-root.txt"
else
  mkdir -p "$INSTALL_DIR/Python"
  cp -R "$PYTHON_ROOT/opencam_rhino" "$INSTALL_DIR/Python/"
  uv pip install --python 3.9 --target "$INSTALL_DIR/Python" "$CONTRACTS_ROOT"
fi

cat <<EOF
Installed $PLUGIN_NAME ($MODE):
  $INSTALL_DIR

Restart Rhino, then run: OpenCam
EOF
