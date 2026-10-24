# OpenCam

Installable Rhino 8/macOS host for OpenCAM panel. C# remains transport only:

- registers document-scoped `OpenCAM` Eto `WebView` panel;
- serves packaged self-contained `web/dist/index.html` from per-panel localhost;
- syncs Rhino theme/font CSS tokens and forwards WebView JSON to
  `opencam_rhino.entry.handle_panel_message`;
- persists opaque document JSON through `PluginDocumentData`;
- invokes Python lifecycle hooks.

Python owns Rhino selection, display conduits, state, backend HTTP, and CAM
request construction. TypeScript owns panel rendering. Backend owns CAM,
simulation, and comparison.

## Build and install

```bash
cd frontend/rhino_frontend/bridge
scripts/build-install-mac.sh --mode development
```

Build uses RhinoCode's generated project as host, merges OpenCAM's C# source,
compiles the parent `rhino_frontend` package, and installs:

```text
~/Library/Application Support/McNeel/Rhinoceros/8.0/MacPlugIns/
  OpenCam.rhp/
```

Restart Rhino after installation, then run `OpenCam`.

Development install reads Python directly from `../python` through
`development-python-root.txt`. After this one-time bridge installation,
reload Python and panel assets without restarting Rhino:

```bash
scripts/reload-development-mac.sh
```

It rebuilds/copies panel assets, clears loaded `opencam_rhino.*` modules,
rebuilds document display state, and reloads every OpenCAM panel.

Production install snapshots `opencam_rhino/` into bundle `Python/`:

```bash
scripts/build-install-mac.sh --mode production
```

## Shareable Yak package

Build a self-contained Rhino 8/macOS package without replacing development install:

```bash
scripts/build-yak-mac.sh --version 0.1.0+0
```

Artifact: `dist/rh8-mac/opencam-<version>-rh8-mac.yak`.
It contains compiled bridge, WebView assets, Rhino Python, and contracts.
Recipient installs by opening `.yak` with Rhino 8. Backend remains separate;
set its URL in OpenCAM panel after installation.

## Generated build anchor

RhinoCode only generates a `.rhp` when project contains code. `commands/bridge_host.py`
is a build anchor; final build removes RhinoCode's generated script command.
Public OpenCAM command is native `OpenCam`. Do not put application logic in anchor.

## Requirements

- Rhino 8 for macOS, including `rhinocode`
- .NET SDK able to build `net48`
- Bun for TypeScript panel build
