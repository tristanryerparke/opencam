using System.Drawing;
using System.Text.Json;
using Rhino.Display;
using Rhino.Geometry;

namespace OpenCamRhinoPlugin.Display;

public sealed class ToolpathPreviewConduit : DisplayConduit
{
    private readonly List<ToolpathCurveRecord> _curves = new();

    public int CurveCount => _curves.Count;

    public int PointCount { get; private set; }

    public void Clear()
    {
        _curves.Clear();
        PointCount = 0;
        Enabled = false;
    }

    public void LoadOperationJson(string operationJson)
    {
        _curves.Clear();
        PointCount = 0;

        using var document = JsonDocument.Parse(operationJson);
        if (!document.RootElement.TryGetProperty("paths", out var paths) || paths.ValueKind != JsonValueKind.Array)
        {
            Enabled = false;
            return;
        }

        foreach (var path in paths.EnumerateArray())
        {
            var kind = path.TryGetProperty("kind", out var kindElement) ? kindElement.GetString() : "cut";
            if (!path.TryGetProperty("locations", out var locations) || locations.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            var points = new List<Point3d>();
            foreach (var location in locations.EnumerateArray())
            {
                if (!TryReadLocation(location, out var point))
                {
                    continue;
                }

                points.Add(point);
            }

            if (points.Count < 2)
            {
                continue;
            }

            PointCount += points.Count;
            _curves.Add(new ToolpathCurveRecord
            {
                Curve = new PolylineCurve(points),
                Color = string.Equals(kind, "clearance", StringComparison.OrdinalIgnoreCase)
                    ? Color.FromArgb(220, 38, 38)
                    : Color.FromArgb(29, 78, 216),
                Width = string.Equals(kind, "clearance", StringComparison.OrdinalIgnoreCase) ? 2 : 3,
            });
        }

        Enabled = _curves.Count > 0;
    }

    protected override void PostDrawObjects(DrawEventArgs e)
    {
        foreach (var record in _curves)
        {
            e.Display.DrawCurve(record.Curve, record.Color, record.Width);
        }
    }

    protected override void CalculateBoundingBox(CalculateBoundingBoxEventArgs e)
    {
        foreach (var record in _curves)
        {
            var box = record.Curve.GetBoundingBox(true);
            if (box.IsValid)
            {
                e.IncludeBoundingBox(box);
            }
        }
    }

    private static bool TryReadLocation(JsonElement element, out Point3d point)
    {
        point = Point3d.Unset;
        if (!element.TryGetProperty("x", out var x)
            || !element.TryGetProperty("y", out var y)
            || !element.TryGetProperty("z", out var z))
        {
            return false;
        }

        point = new Point3d(x.GetDouble(), y.GetDouble(), z.GetDouble());
        return point.IsValid;
    }

    private sealed class ToolpathCurveRecord
    {
        public Curve Curve { get; init; } = null!;
        public Color Color { get; init; }
        public int Width { get; init; }
    }
}
