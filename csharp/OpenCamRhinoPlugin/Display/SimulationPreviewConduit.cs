using System.Drawing;
using Rhino.Display;
using Rhino.Geometry;

namespace OpenCamRhinoPlugin.Display;

public sealed class SimulationPreviewConduit : DisplayConduit
{
    private Mesh? _cachedStockMesh;
    private Mesh? _activeCutMesh;
    private Mesh? _toolMesh;
    private Transform _toolTransform = Transform.Identity;

    private readonly DisplayMaterial _cachedMaterial = new(Color.FromArgb(251, 146, 60), 0.0);
    private readonly DisplayMaterial _activeMaterial = new(Color.FromArgb(156, 163, 175), 0.0);
    private readonly DisplayMaterial _toolMaterial = new(Color.FromArgb(107, 114, 128), 0.0);

    public bool HasMeshes => _cachedStockMesh != null || _activeCutMesh != null || _toolMesh != null;

    public void Clear()
    {
        _cachedStockMesh = null;
        _activeCutMesh = null;
        _toolMesh = null;
        _toolTransform = Transform.Identity;
        Enabled = false;
    }

    public void LoadFrame(Mesh? cachedStockMesh, Mesh? activeCutMesh, Mesh? toolMesh, Point3d toolPosition)
    {
        _cachedStockMesh = PrepareMesh(cachedStockMesh);
        _activeCutMesh = PrepareMesh(activeCutMesh);
        _toolMesh = PrepareMesh(toolMesh);
        _toolTransform = Transform.Translation(toolPosition - Point3d.Origin);
        Enabled = HasMeshes;
    }

    protected override void PostDrawObjects(DrawEventArgs e)
    {
        if (_cachedStockMesh != null)
        {
            DrawMesh(e, _cachedStockMesh, _cachedMaterial, Color.FromArgb(194, 65, 12));
        }

        if (_activeCutMesh != null)
        {
            DrawMesh(e, _activeCutMesh, _activeMaterial, Color.FromArgb(75, 85, 99));
        }

        if (_toolMesh != null)
        {
            var transformedTool = _toolMesh.DuplicateMesh();
            transformedTool.Transform(_toolTransform);
            DrawMesh(e, transformedTool, _toolMaterial, Color.FromArgb(31, 41, 55));
        }
    }

    protected override void CalculateBoundingBox(CalculateBoundingBoxEventArgs e)
    {
        IncludeMesh(e, _cachedStockMesh, Transform.Identity);
        IncludeMesh(e, _activeCutMesh, Transform.Identity);
        IncludeMesh(e, _toolMesh, _toolTransform);
    }

    private static void DrawMesh(DrawEventArgs e, Mesh mesh, DisplayMaterial material, Color wireColor)
    {
        e.Display.DrawMeshShaded(mesh, material);
        e.Display.DrawMeshWires(mesh, wireColor, 1);
    }

    private static void IncludeMesh(CalculateBoundingBoxEventArgs e, Mesh? mesh, Transform transform)
    {
        if (mesh == null)
        {
            return;
        }

        var box = mesh.GetBoundingBox(transform);
        if (box.IsValid)
        {
            e.IncludeBoundingBox(box);
        }
    }

    private static Mesh? PrepareMesh(Mesh? mesh)
    {
        if (mesh == null)
        {
            return null;
        }

        var copy = mesh.DuplicateMesh();
        if (copy.Normals.Count == 0)
        {
            copy.Normals.ComputeNormals();
        }
        copy.Compact();
        return copy.IsValid ? copy : null;
    }
}
