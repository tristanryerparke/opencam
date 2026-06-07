using Rhino;
using Rhino.DocObjects;
using Rhino.Geometry;
using Rhino.Input;
using Rhino.Input.Custom;

namespace OpenCamRhinoPlugin.Services;

public sealed class RhinoSelectionService
{
    private const double PlaneTolerance = 1e-5;
    private const double WorldZAlignment = 1.0 - 1e-5;

    public SelectedStock? SelectStock(RhinoDoc doc)
    {
        var getter = new GetObject();
        getter.SetCommandPrompt("Select stock mesh or polysurface for OpenCAM");
        getter.GeometryFilter = ObjectType.Mesh | ObjectType.Brep;
        getter.SubObjectSelect = false;
        getter.EnablePreSelect(false, true);

        if (getter.Get() != GetResult.Object)
        {
            return null;
        }

        var objRef = getter.Object(0);
        var mesh = MeshFromObject(objRef);
        if (mesh == null || mesh.Vertices.Count == 0 || mesh.Faces.Count == 0)
        {
            throw new InvalidOperationException("Selected stock could not be converted to a mesh.");
        }

        mesh.Faces.ConvertQuadsToTriangles();
        mesh.Normals.ComputeNormals();
        mesh.Compact();

        var rhinoObject = objRef.Object();
        var name = string.IsNullOrWhiteSpace(rhinoObject?.Name) ? "Rhino stock" : rhinoObject!.Name;

        return new SelectedStock
        {
            ObjectId = objRef.ObjectId.ToString(),
            Name = name,
            StlBytes = StlWriter.WriteAscii(mesh, "opencam_stock"),
            Bounds = mesh.GetBoundingBox(true),
            VertexCount = mesh.Vertices.Count,
            FaceCount = mesh.Faces.Count,
        };
    }

    public SelectedPocketBoundary? SelectPocketBoundary(RhinoDoc doc)
    {
        var getter = new GetObject();
        getter.SetCommandPrompt("Select a closed pocket curve or Brep face");
        getter.GeometryFilter = ObjectType.Curve | ObjectType.Surface;
        getter.SubObjectSelect = true;
        getter.EnablePreSelect(false, true);

        if (getter.Get() != GetResult.Object)
        {
            return null;
        }

        var objRef = getter.Object(0);
        var sourceKind = "curve";
        Curve? boundaryCurve = objRef.Curve();

        if (boundaryCurve == null)
        {
            var face = objRef.Face();
            if (face == null)
            {
                throw new InvalidOperationException("Selection was not a curve or Brep face.");
            }

            boundaryCurve = OuterLoopCurve(face);
            sourceKind = "brep-face";
        }

        if (boundaryCurve == null)
        {
            throw new InvalidOperationException("Could not extract a pocket boundary curve.");
        }

        if (!boundaryCurve.IsClosed)
        {
            throw new InvalidOperationException("Pocket boundary must be closed.");
        }

        if (!boundaryCurve.TryGetPlane(out var plane, PlaneTolerance))
        {
            throw new InvalidOperationException("Pocket boundary must be planar.");
        }

        var zAlignment = Math.Abs(plane.Normal * Vector3d.ZAxis);
        if (zAlignment < WorldZAlignment)
        {
            throw new InvalidOperationException("MVP pocket boundaries must be parallel to World XY.");
        }

        var polyline = PolylineFromCurve(boundaryCurve);
        if (polyline.Count < 4 || !polyline.IsClosed)
        {
            throw new InvalidOperationException("Pocket boundary could not be converted to a closed polyline.");
        }

        return new SelectedPocketBoundary
        {
            ObjectId = objRef.ObjectId.ToString(),
            SourceKind = sourceKind,
            Plane = plane,
            Polyline = polyline,
        };
    }

    private static Mesh? MeshFromObject(ObjRef objRef)
    {
        if (objRef.Mesh() is { } selectedMesh)
        {
            return selectedMesh.DuplicateMesh();
        }

        var brep = objRef.Brep();
        if (brep == null)
        {
            return null;
        }

        var meshes = Mesh.CreateFromBrep(brep, MeshingParameters.Default);
        if (meshes == null || meshes.Length == 0)
        {
            return null;
        }

        var combined = new Mesh();
        foreach (var mesh in meshes)
        {
            if (mesh != null)
            {
                combined.Append(mesh);
            }
        }

        return combined;
    }

    private static Curve? OuterLoopCurve(BrepFace face)
    {
        var loop = face.OuterLoop;
        if (loop != null)
        {
            return loop.To3dCurve();
        }

        foreach (var candidate in face.Loops)
        {
            if (candidate.LoopType == BrepLoopType.Outer)
            {
                return candidate.To3dCurve();
            }
        }

        return null;
    }

    private static Polyline PolylineFromCurve(Curve curve)
    {
        if (curve.TryGetPolyline(out var exactPolyline))
        {
            return EnsureClosed(exactPolyline);
        }

        var length = Math.Max(curve.GetLength(), 1.0);
        var segmentCount = Math.Clamp((int)Math.Ceiling(length / 2.0), 24, 2000);
        var parameters = curve.DivideByCount(segmentCount, true);
        if (parameters == null || parameters.Length == 0)
        {
            throw new InvalidOperationException("Could not sample pocket boundary curve.");
        }

        var sampled = new Polyline(parameters.Select(curve.PointAt));
        return EnsureClosed(sampled);
    }

    private static Polyline EnsureClosed(Polyline polyline)
    {
        if (polyline.Count == 0)
        {
            return polyline;
        }

        if (!polyline.IsClosed)
        {
            polyline.Add(polyline[0]);
        }

        return polyline;
    }
}
