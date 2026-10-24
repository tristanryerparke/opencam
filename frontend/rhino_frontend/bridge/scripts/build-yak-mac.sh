#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INTEGRATION_ROOT="$(cd "$BRIDGE_ROOT/.." && pwd)"
PROJECT_ROOT="$(cd "$INTEGRATION_ROOT/../.." && pwd)"
CONTRACTS_ROOT="$PROJECT_ROOT/contracts"
RHINOCODE="${RHINOCODE:-/Applications/Rhino 8.app/Contents/Resources/bin/rhinocode}"
RHINO_PROJECT="$BRIDGE_ROOT/opencam-rhino-bridge.rhproj"
OUTPUT_ROOT="$BRIDGE_ROOT/dist"
GENERATED_ROOT="$OUTPUT_ROOT/rh8-mac"
GENERATED_PROJECT="$GENERATED_ROOT/src/OpenCam/OpenCam.csproj"
GENERATED_PLUGIN="$GENERATED_ROOT/OpenCam.rhp"
PROJECT_DATA_EXTRACTOR="$BRIDGE_ROOT/utilities/ProjectDataExtractor/ProjectDataExtractor.csproj"
PYTHON_ROOT="$INTEGRATION_ROOT/python"
WEB_ROOT="$INTEGRATION_ROOT"
PLUGIN_NAME="OpenCam"
VERSION="0.1.0+0"

usage() {
  cat <<'EOF'
Usage: scripts/build-yak-mac.sh [--version VERSION]

Builds a self-contained Rhino 8 for macOS Yak package. The package includes
OpenCAM's compiled C# bridge, WebView assets, Rhino Python, and Python
contracts. It never modifies the development plug-in installation.

Environment:
  RHINOCODE  Override Rhino 8's rhinocode executable.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$OSTYPE" == darwin* ]] || { echo "This package build targets macOS (OSTYPE=$OSTYPE)." >&2; exit 1; }
[[ -n "$VERSION" ]] || { echo "Version must not be empty." >&2; exit 2; }
[[ -x "$RHINOCODE" ]] || { echo "RhinoCode CLI missing: $RHINOCODE" >&2; exit 1; }
[[ -d "$PYTHON_ROOT/opencam_rhino" ]] || { echo "OpenCAM Python missing: $PYTHON_ROOT/opencam_rhino" >&2; exit 1; }
[[ -f "$CONTRACTS_ROOT/pyproject.toml" ]] || { echo "OpenCAM contracts missing: $CONTRACTS_ROOT" >&2; exit 1; }
[[ -f "$WEB_ROOT/index.html" ]] || { echo "OpenCAM WebView source missing: $WEB_ROOT/index.html" >&2; exit 1; }

rm -rf "$OUTPUT_ROOT"
echo "Generating RhinoCode Yak skeleton..."
"$RHINOCODE" project build "$RHINO_PROJECT" \
  --buildversion "$VERSION" \
  --buildtarget '8.*-macOS' \
  --buildpath "$OUTPUT_ROOT"

[[ -f "$GENERATED_PLUGIN" ]] || { echo "Generated plug-in missing: $GENERATED_PLUGIN" >&2; exit 1; }
[[ -f "$GENERATED_PROJECT" ]] || { echo "Generated project missing: $GENERATED_PROJECT" >&2; exit 1; }

OPENCAM_RHINO_GENERATED_ROOT="$GENERATED_ROOT" \
  dotnet run --project "$PROJECT_DATA_EXTRACTOR" -- \
  "$GENERATED_PLUGIN" "$(dirname "$GENERATED_PROJECT")/Plugin.Data.resources"
OPENCAM_RHINO_GENERATED_ROOT="$GENERATED_ROOT" \
  python3 "$SCRIPT_DIR/prepare-script-plugin.py"

echo "Building self-contained WebView pages..."
(cd "$WEB_ROOT" && bun run build)
[[ -f "$WEB_ROOT/dist/index.html" ]] || { echo "WebView build did not create dist/index.html." >&2; exit 1; }

echo "Building $PLUGIN_NAME (Release)..."
dotnet build "$GENERATED_PROJECT" -c Release
COMPILED_PLUGIN="$GENERATED_ROOT/src/OpenCam/bin/Release/net48/$PLUGIN_NAME.rhp"
[[ -f "$COMPILED_PLUGIN" ]] || { echo "Compiled plug-in missing: $COMPILED_PLUGIN" >&2; exit 1; }

PACKAGE="$(find "$GENERATED_ROOT" -maxdepth 1 -type f -name '*.yak' -print -quit)"
[[ -n "$PACKAGE" ]] || { echo "RhinoCode did not create a Yak package." >&2; exit 1; }

STAGING_ROOT="$(mktemp -d)"
cleanup() { rm -rf "$STAGING_ROOT"; }
trap cleanup EXIT

cp "$GENERATED_ROOT/manifest.yml" "$STAGING_ROOT/manifest.yml"
cp "$COMPILED_PLUGIN" "$STAGING_ROOT/$PLUGIN_NAME.rhp"
[[ -f "$GENERATED_ROOT/$PLUGIN_NAME.rui" ]] && cp "$GENERATED_ROOT/$PLUGIN_NAME.rui" "$STAGING_ROOT/"
mkdir -p "$STAGING_ROOT/web" "$STAGING_ROOT/Python"
cp -R "$WEB_ROOT/dist" "$STAGING_ROOT/web/"
cp -R "$PYTHON_ROOT/opencam_rhino" "$STAGING_ROOT/Python/"
uv pip install --python 3.9 --target "$STAGING_ROOT/Python/site-packages" "$CONTRACTS_ROOT"
find "$STAGING_ROOT" -type d -name '__pycache__' -prune -exec rm -rf {} +

rm -f "$PACKAGE"
(
  cd "$STAGING_ROOT"
  find . -type f -print | LC_ALL=C sort | zip -q "$PACKAGE" -@
)

unzip -t "$PACKAGE" >/dev/null
[[ "$(unzip -p "$PACKAGE" "$PLUGIN_NAME.rhp" | shasum -a 256 | awk '{print $1}')" == "$(shasum -a 256 "$COMPILED_PLUGIN" | awk '{print $1}')" ]] \
  || { echo "Yak contains wrong plug-in assembly." >&2; exit 1; }
unzip -Z1 "$PACKAGE" | grep -Fx 'web/dist/index.html' >/dev/null
unzip -Z1 "$PACKAGE" | grep -Fx 'Python/opencam_rhino/actions.py' >/dev/null
unzip -Z1 "$PACKAGE" | grep -Fx 'Python/site-packages/opencam_contracts/cam.py' >/dev/null

printf 'Built and validated: %s\n' "$PACKAGE"
