# C# shim contract

Installable implementation: `../bridge/` (`OpenCamRhinoBridge`).

C# responsibilities only:

1. Register per-document Eto `WebView` panel and native `OpenCam` command.
2. Serve self-contained `web/dist/index.html` from localhost, avoiding
   file-origin WebView restrictions; sync Rhino theme/font CSS tokens.
3. Forward WebView JSON to Python:
   `opencam_rhino.entry.handle_panel_message(documentSerial, requestJson)`.
4. Return Python response to page via `window.opencamRhino.receive(...)`.
5. Store opaque document-state JSON and invoke Python lifecycle hooks.

`RunPythonJson` wraps RhinoCode `CreatePython3Script`; Python result crosses
back through `OpenCamRhinoBridge.PanelResponseSink`. Exceptions write Rhino
command-history error and produce JSON panel error instead of crashing panel.

Never add Rhino selection, meshes, HTTP, persistence policy, toolpath drawing,
or CAM construction here. Those remain Python/backend responsibilities.

Legacy C#-only prototype has been removed. Keep this shim limited to responsibilities above.
