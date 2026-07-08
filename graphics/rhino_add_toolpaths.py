from __future__ import annotations

import json
import os

import Rhino
import System
import scriptcontext as sc
from rhino_renderer.redis_utils import REDIS

PAYLOAD_KEY = "opencam:rhino_toolpath_payload"


def current_doc():
    active_doc = getattr(Rhino.RhinoDoc, "ActiveDoc", None)
    if callable(active_doc):
        active_doc = active_doc()
    return active_doc or sc.doc


def normalized_path(path):
    if not path:
        return None
    return os.path.normcase(os.path.abspath(str(path)))


def find_child_layer(doc, parent_id, name):
    for layer in doc.Layers:
        if layer.Name == name and layer.ParentLayerId == parent_id:
            return layer
    return None


def ensure_layer(doc, parent_name, child_name):
    parent = doc.Layers.FindName(parent_name)
    if parent is None:
        parent = Rhino.DocObjects.Layer()
        parent.Name = parent_name
        parent.Color = System.Drawing.Color.Cyan
        parent_index = doc.Layers.Add(parent)
        if parent_index < 0:
            raise RuntimeError("Could not create layer " + parent_name)
        parent = doc.Layers[parent_index]
    else:
        parent.Color = System.Drawing.Color.Cyan
        doc.Layers.Modify(parent, parent.Index, True)

    layer = find_child_layer(doc, parent.Id, child_name)
    if layer is None:
        layer = Rhino.DocObjects.Layer()
        layer.Name = child_name
        layer.ParentLayerId = parent.Id
        layer.Color = System.Drawing.Color.Cyan
        index = doc.Layers.Add(layer)
    else:
        layer.Color = System.Drawing.Color.Cyan
        index = layer.Index
        doc.Layers.Modify(layer, index, True)
    if index < 0:
        raise RuntimeError("Could not create layer " + parent_name + "->" + child_name)
    return index


def delete_layer_objects(doc, layer_index):
    layer = doc.Layers[layer_index]
    for rhino_object in doc.Objects.FindByLayer(layer) or []:
        doc.Objects.Delete(rhino_object, True)


def add_polyline_curve(doc, points, attributes):
    polyline = Rhino.Geometry.Polyline()
    for x, y, z in points:
        polyline.Add(Rhino.Geometry.Point3d(float(x), float(y), float(z)))
    if polyline.Count < 2:
        return False
    curve = Rhino.Geometry.PolylineCurve(polyline)
    object_id = doc.Objects.AddCurve(curve, attributes)
    return object_id != System.Guid.Empty


def main():
    raw_payload = REDIS.get(PAYLOAD_KEY)
    if not raw_payload:
        raise RuntimeError("Missing OpenCAM toolpath payload in Redis")
    REDIS.delete(PAYLOAD_KEY)

    payload = json.loads(raw_payload)
    doc = current_doc()
    if doc is None:
        raise RuntimeError("No active Rhino document found")

    expected = normalized_path(payload.get("document_path"))
    active = normalized_path(getattr(doc, "Path", None))
    if expected and active and expected != active:
        raise RuntimeError("Active Rhino document changed before adding toolpaths")

    layer_index = ensure_layer(doc, payload["parent_layer_name"], payload["layer_name"])
    delete_layer_objects(doc, layer_index)
    count = 0
    for path in payload["paths"]:
        attributes = Rhino.DocObjects.ObjectAttributes()
        attributes.LayerIndex = layer_index
        attributes.Name = path["name"]
        attributes.ColorSource = Rhino.DocObjects.ObjectColorSource.ColorFromLayer
        if add_polyline_curve(doc, path["points"], attributes):
            count += 1

    doc.Views.Redraw()
    print(
        "Added "
        + str(count)
        + " real Rhino curves to layer "
        + payload["parent_layer_name"]
        + "->"
        + payload["layer_name"]
    )


if __name__ == "__main__":
    main()
