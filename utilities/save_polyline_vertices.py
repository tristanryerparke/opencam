import json

import rhinoscriptsyntax as rs


def main():
    polyline_id = rs.GetObject("Select a polyline", rs.filter.curve)
    if not polyline_id:
        return
    if not rs.IsPolyline(polyline_id):
        rs.MessageBox("Selected object is not a polyline.", "Save Polyline Vertices")
        return

    path = rs.SaveFileName(
        "Save polyline vertices",
        "JSON Files (*.json)|*.json||",
        extension="json",
    )
    if not path:
        return

    vertices = rs.PolylineVertices(polyline_id)
    with open(path, "w") as output:
        json.dump([[point.X, point.Y, point.Z] for point in vertices], output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()
