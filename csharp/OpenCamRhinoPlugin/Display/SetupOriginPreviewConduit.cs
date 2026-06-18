using System.Drawing;
using Rhino.Display;
using Rhino.Geometry;

namespace OpenCamRhinoPlugin.Display;

public sealed class SetupOriginPreviewConduit : DisplayConduit
{
    private const double DefaultAxisLength = 25.0;
    private const double ArrowLengthFactor = 0.2;
    private const double ArrowWidthFactor = 0.08;

    public Point3d? Origin { get; private set; }
    public string? Label { get; private set; }

    public void Show(Point3d origin)
    {
        Show(origin, null);
    }

    public void Show(Point3d origin, string? label)
    {
        Origin = origin;
        Label = label;
        Enabled = true;
    }

    public void Clear()
    {
        Origin = null;
        Label = null;
        Enabled = false;
    }

    protected override void PostDrawObjects(DrawEventArgs e)
    {
        if (Origin is not Point3d origin)
        {
            return;
        }

        DrawAxis(e, origin, Vector3d.XAxis, Color.Red);
        DrawAxis(e, origin, Vector3d.YAxis, Color.LimeGreen);
        DrawAxis(e, origin, Vector3d.ZAxis, Color.FromArgb(0, 0, 255));

        if (!string.IsNullOrWhiteSpace(Label))
        {
            e.Display.DrawDot(origin, Label, Color.White, Color.Black);
        }
    }

    protected override void CalculateBoundingBox(CalculateBoundingBoxEventArgs e)
    {
        if (Origin is not Point3d origin)
        {
            return;
        }

        e.IncludeBoundingBox(new BoundingBox(new[]
        {
            origin,
            origin + (Vector3d.XAxis * DefaultAxisLength),
            origin + (Vector3d.YAxis * DefaultAxisLength),
            origin + (Vector3d.ZAxis * DefaultAxisLength),
        }));
    }

    private static void DrawAxis(DrawEventArgs e, Point3d origin, Vector3d axis, Color color)
    {
        var direction = axis;
        direction.Unitize();

        var end = origin + (direction * DefaultAxisLength);
        e.Display.DrawLine(origin, end, color, 2);
        DrawArrowHead(e, end, direction, color);
    }

    private static void DrawArrowHead(DrawEventArgs e, Point3d tip, Vector3d direction, Color color)
    {
        var arrowLength = DefaultAxisLength * ArrowLengthFactor;
        var arrowWidth = DefaultAxisLength * ArrowWidthFactor;
        var baseCenter = tip - (direction * arrowLength);

        var up = Math.Abs(direction.Z) < 0.9 ? Vector3d.ZAxis : Vector3d.XAxis;
        var perpendicular = Vector3d.CrossProduct(direction, up);
        if (!perpendicular.Unitize())
        {
            return;
        }

        var sideA = baseCenter + (perpendicular * arrowWidth);
        var sideB = baseCenter - (perpendicular * arrowWidth);

        e.Display.DrawLine(sideA, tip, color, 2);
        e.Display.DrawLine(sideB, tip, color, 2);
    }
}
