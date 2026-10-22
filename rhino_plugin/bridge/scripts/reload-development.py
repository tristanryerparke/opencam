#! python 3
"""Reload OpenCAM Python and current WebView page without restarting Rhino."""

import importlib
import sys

import Rhino
from OpenCamRhinoBridge import PluginBridge
from run_in_rhino.rhino_env.client import SocketConnection
from run_in_rhino.rhino_env.parasite import OutputParasite

PACKAGE_NAME = "opencam_rhino"


def forget_package_modules():
    module_names = sorted(
        (name for name in tuple(sys.modules) if name == PACKAGE_NAME or name.startswith(PACKAGE_NAME + ".")),
        key=lambda name: name.count("."),
        reverse=True,
    )
    for module_name in module_names:
        module = sys.modules.get(module_name)
        parent_name, _, child_name = module_name.rpartition(".")
        parent = sys.modules.get(parent_name)
        if parent is not None and getattr(parent, child_name, None) is module:
            delattr(parent, child_name)
        sys.modules.pop(module_name, None)
    return module_names


def reload_development():
    if not PluginBridge.IsDevelopmentMode:
        raise RuntimeError("OpenCAM reload is only available in development mode.")

    python_root = str(PluginBridge.PythonRoot)
    if python_root in sys.path:
        sys.path.remove(python_root)
    sys.path.insert(0, python_root)

    existing_tracking = sys.modules.get(PACKAGE_NAME + ".object_tracking")
    if existing_tracking is not None:
        existing_tracking.shutdown()
    existing_runtime = sys.modules.get(PACKAGE_NAME + ".runtime")
    if existing_runtime is not None:
        existing_runtime.shutdown()

    module_names = forget_package_modules()
    importlib.invalidate_caches()
    from opencam_rhino import object_tracking, runtime, state

    object_tracking.subscribe()

    panels = 0
    restored = 0
    for document in Rhino.RhinoDoc.OpenDocuments(False):
        document_state = state.load(document)
        runtime.restore_document(document, document_state)
        object_tracking.rebuild(document, document_state)
        document.Views.Redraw()
        restored += 1
        panels += PluginBridge.ReloadPanel(document.RuntimeSerialNumber)

    Rhino.RhinoApp.WriteLine(
        "Reloaded OpenCAM source: {} module(s), {} document(s), {} panel(s).".format(
            len(module_names), restored, panels
        )
    )


if __name__ == "__main__":
    try:
        connection = SocketConnection()
    except Exception:
        connection = None
    with OutputParasite(connection, done_msg=True):
        reload_development()
