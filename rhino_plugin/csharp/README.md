# C# shim contract

Use the existing `rhino-python-plugin-template` as the installable Rhino 8
project. Rename its assembly/namespace to `OpenCamRhinoBridge`; retain its
per-document panel and JSON archive bridge.

Replace the template's Python Eto content host with an Eto `WebView` host:

1. Load `web/dist/index.html` (or a bundled equivalent).
2. On `MessageReceived`, call `PanelMessageBridge.Dispatch(documentSerial, e.Message)`.
3. JSON-serialize the returned string and execute
   `window.opencamRhino.receive(<quoted-result>)`.
4. Never perform Rhino selection, mesh conversion, HTTP, persistence policy,
   toolpath display, or CAM construction in C#.

`RunPythonJson` is the only addition needed to the template launcher: it uses
the existing `CreatePython3Script` path, executes the supplied Python body,
and retrieves the named string variable. It must report Python exceptions to
Rhino command history and return an error event instead of crashing the panel.

The old `csharp/OpenCamRhinoPlugin` is valuable API reconnaissance (mesh
export, conduit ideas, HTTP endpoints), but it is not the implementation base:
it duplicates selection/operation behavior in C# and predates the current
`/cam/toolpath` contract.
