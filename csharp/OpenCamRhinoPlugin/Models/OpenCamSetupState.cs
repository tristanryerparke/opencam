using Rhino.Geometry;

namespace OpenCamRhinoPlugin.Models;

public sealed class OpenCamSetupState
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "Setup";
    public Point3d Origin { get; set; } = Point3d.Origin;
    public List<OpenCamOperationState> Operations { get; set; } = new();
}

public sealed class OpenCamOperationState
{
    public string Name { get; set; } = "Operation";
}
