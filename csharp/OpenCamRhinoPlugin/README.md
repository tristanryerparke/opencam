# OpenCAM Rhino Plugin

C#-only Rhino 8 plugin prototype. It uses Rhino's built-in Eto forms for the dockable panel and setup dialog, and talks to the OpenCAM FastAPI backend directly over HTTP.

This intentionally does **not** depend on `rhino-python-renderer`, Redis, the RhinoCode pipe, WebView, or any JavaScript frontend bundle.

## Current scope

Implemented:

- Rhino command: `OpenCam`
- per-document dockable Eto panel via `Rhino.UI.Panels.RegisterPanel`
- native Eto version of the basic panel UI from the former JS frontend:
  - `Setup` button
  - `Operation` button
  - backend status indicator placeholder
  - empty panel body
- native Eto setup dialog placeholder

Not implemented yet:

- full operation workflow wiring in the Eto UI
- simulation controls in the Eto UI
- lazy simulation frame cache in C#
- arbitrary machining plane transforms
- hole/island pocket regions

## Backend

Start the OpenCAM API separately, for example:

```bash
python main.py
```

or:

```bash
uvicorn src.server.main:app --reload --port 9090
```

The panel defaults to:

```text
http://127.0.0.1:9090
```

## macOS install helper

From the repository root:

```bash
scripts/install-opencam-rhino-plugin-mac.sh
```

This builds the plugin and copies the full build output to:

```text
~/Library/Application Support/McNeel/Rhinoceros/MacPlugIns/OpenCamRhinoPlugin.rhp
```

Useful variants:

```bash
scripts/install-opencam-rhino-plugin-mac.sh -c Release
scripts/install-opencam-rhino-plugin-mac.sh --no-build
```

After installing, restart Rhino if it was already open, then run:

```text
OpenCam
```

## Build note

The project is set up as a Rhino 8 `net8.0` plugin prototype using the `RhinoCommon` NuGet package. Rhino installation/build packaging details may need local adjustment depending on Mac/Windows Rhino SDK setup.
