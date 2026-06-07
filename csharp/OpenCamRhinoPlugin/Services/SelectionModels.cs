using Rhino.Geometry;

namespace OpenCamRhinoPlugin.Services;

public sealed class SelectedStock
{
    public string ObjectId { get; init; } = string.Empty;
    public string Name { get; init; } = "Rhino stock";
    public byte[] StlBytes { get; init; } = Array.Empty<byte>();
    public BoundingBox Bounds { get; init; }
    public int VertexCount { get; init; }
    public int FaceCount { get; init; }
}

public sealed class SelectedPocketBoundary
{
    public string ObjectId { get; init; } = string.Empty;
    public string SourceKind { get; init; } = string.Empty;
    public Plane Plane { get; init; } = Plane.WorldXY;
    public Polyline Polyline { get; init; } = new();
    public double PlaneZ => Plane.OriginZ;
}
