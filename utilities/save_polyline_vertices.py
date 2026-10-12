import json

import rhinoscriptsyntax as rs


def main():
    curve_id = rs.GetObject("Select a polyline or NURBS curve", rs.filter.curve)
    if not curve_id:
        return

    polyline_id = curve_id
    converted_id = None
    if not rs.IsPolyline(curve_id):
        converted_id = rs.ConvertCurveToPolyline(curve_id, tolerance=0.01)
        if not converted_id:
            rs.MessageBox(
                "Could not convert selected curve to a polyline.",
                "Save Polyline Vertices",
            )
            return
        polyline_id = converted_id

    path = rs.SaveFileName(
        "Save polyline vertices",
        "JSON Files (*.json)|*.json||",
        extension="json",
    )
    if not path:
        if converted_id:
            rs.DeleteObject(converted_id)
        return

    vertices = rs.PolylineVertices(polyline_id)
    with open(path, "w") as output:
        json.dump([[point.X, point.Y, point.Z] for point in vertices], output, indent=2)
        output.write("\n")

    if converted_id:
        rs.DeleteObject(converted_id)


if __name__ == "__main__":
    main()
