# Web-viewer parity plan

The Rhino panel is a native CAD front end for the **same FastAPI API**, not a
second CAM engine. This maps every current web-viewer capability to its Rhino
counterpart and gives a dependency order.

| Web-viewer capability | Rhino implementation | Status |
| --- | --- | --- |
| Backend health / URL | Python `GET /ping`; user setting, shown by WebView | Planned |
| Part import/cache | `GetObject(Brep)`, mesh in Python, inline `setup.part_mesh`; later optional mesh-cache endpoint | Frameworked |
| Stock | world-axis bounding box generated from selected part; preview conduit | Frameworked selection, preview pending |
| Setup origin | Rhino point getter / CPlane-aware setup dialog; persist transform | Planned |
| Planar drive geometry | planar face loops or joined Brep edges/curves via `GetObject` subobject selection | Frameworked |
| Pocket + profile | panel operation editor emits existing Pydantic JSON to `/cam/toolpath` | Generate frameworked |
| Parallel finishing | selected Brep mesh + surface strategy JSON; `/cam/toolpath` | Planned |
| Adaptive pocketing settings | same operation JSON controls as browser | Planned (no Rhino algorithm fork) |
| Tool library CRUD | panel -> Python -> `/cam/tools` | Planned |
| Toolpath viewport | Python `DisplayConduit`, records grouped by rapid/cut/link, no duplicate document geometry | Implemented; interactive viewport check pending |
| Simulation start/status/frame | Python adapter to current `/simulate/*` routes; lazy frame cache and conduit | Implemented; end-to-end host test + live mesh-layer probe pass, interactive viewport check pending |
| Simulation playback | WebView timeline drives Python display request; C# only forwards message | Frameworked (◀/▶ stepping); interactive check pending |
| Stock/result comparison | backend comparison endpoints plus Rhino mesh/color conduit | Implemented (vertex-colored GLB); interactive check pending |
| Post processing | backend post endpoint/download; Eto save dialog only for user-selected output target | Planned |
| Operation/setup tree | TypeScript state projection from persisted Python document state | Planned |
| Save/reopen | C# JSON archive bridge; references and settings only | Frameworked |
| Undo/Redo / deleted sources | command-end reconciliation and stable GUID validation, never auto-regenerate | Planned |

## Non-negotiable boundaries

- A **part** is a selected polysurface/Brep. Its stock is the bounding box;
  users do not upload a STEP/STL to the panel.
- A 2.5D **region** is selected with Rhino getters, not picked from a browser
  mesh. Face selection preserves inner loops; edge selection requires closed,
  coplanar connected loops.
- Current 2.5D generation is World-XY oriented. The selector deliberately
  stores arbitrary planar frames now; coordinate-frame conversion is a named
  next step, not an implicit incorrect projection.
- The C# host owns only panel registration, WebView transport, Python startup,
  and document JSON archival. UI is TypeScript; domain code is Python.
- Long HTTP/simulation work must never run in a Rhino display callback or
  command event handler. User actions explicitly start it and UI-thread code
  applies results after it completes.

## API contract notes (verified against source and an end-to-end host test)

`rhino_plugin/tests/test_simulation_meshes.py` drives the real FastAPI app:
`POST /cam/toolpath` → `POST /simulate` (multipart stock STL + CL JSON) →
`GET /simulate/{task}/status` → tool/chunk-cached/active-frame/final GLBs →
`GET /simulate/{sim}/comparison` → vertex-colored comparison GLB. All mesh
endpoints parse with the plugin's stdlib GLB reader (`glb.py`), which also runs
inside Rhino's Python 3.9 runtime. The backend additionally offers
`.rhino.json` variants for the tool and chunk-cached meshes (rhino3dm-encoded);
the plugin currently uses the GLB endpoints uniformly for all layers.
