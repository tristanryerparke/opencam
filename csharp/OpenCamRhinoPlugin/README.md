# OpenCAM Rhino Plugin

C#-only Rhino 8 plugin prototype. It hosts a bundled TypeScript/Vite web UI in an `Eto.Forms.WebView` dockable Rhino panel and talks to the OpenCAM FastAPI backend directly over HTTP.

This intentionally does **not** depend on `rhino-python-renderer`, Redis, or the RhinoCode pipe.

## Current scope

Implemented:

- Rhino command: `OpenCam`
- per-document dockable panel via `Rhino.UI.Panels.RegisterPanel`
- `Eto.Forms.WebView` host
- JS -> C# bridge via `rhino://message?...`
- C# -> JS replies via WebView script execution
- stock selection from Rhino mesh/Brep
- Brep-to-mesh conversion and in-memory ASCII STL export
- closed pocket boundary selection from closed curve or Brep face
- preset `/pocket/closed` request generation
- direct HTTP calls to OpenCAM backend
- C# conduit preview for generated toolpath curves
- `/simulate/swept` task start and status polling hooks

Not implemented yet:

- fetching/decoding/displaying simulation GLB or Rhino JSON mesh assets
- lazy simulation frame cache in C#
- arbitrary machining plane transforms
- hole/island pocket regions
- Rhino-side parameter editing UI

## Development UI

In Debug builds, the panel loads Vite from:

```text
http://localhost:5174/
```

Run:

```bash
cd csharp/OpenCamRhinoPlugin/web-ui
npm install
npm run dev
```

For production-style local files:

```bash
cd csharp/OpenCamRhinoPlugin/web-ui
npm run build
```

The build output is written to:

```text
csharp/OpenCamRhinoPlugin/web/
```

The plugin project copies `web/**` to the output directory.

## Backend

Start the OpenCAM API separately, for example:

```bash
uvicorn src.server.main:app --reload
```

The panel defaults to:

```text
http://localhost:8000
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
