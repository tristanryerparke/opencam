using System.Globalization;
using System.Text;
using Rhino.Geometry;

namespace OpenCamRhinoPlugin.Services;

public static class StlWriter
{
    public static byte[] WriteAscii(Mesh mesh, string solidName = "opencam_stock")
    {
        if (mesh.Vertices.Count == 0 || mesh.Faces.Count == 0)
        {
            throw new ArgumentException("Mesh is empty.", nameof(mesh));
        }

        var prepared = mesh.DuplicateMesh();
        prepared.Faces.ConvertQuadsToTriangles();
        prepared.FaceNormals.ComputeFaceNormals();
        prepared.Normals.ComputeNormals();
        prepared.Compact();

        var builder = new StringBuilder();
        builder.Append("solid ").AppendLine(SanitizeName(solidName));

        for (var faceIndex = 0; faceIndex < prepared.Faces.Count; faceIndex++)
        {
            var face = prepared.Faces[faceIndex];
            var normal = prepared.FaceNormals[faceIndex];
            WriteFacet(builder, prepared, normal, face.A, face.B, face.C);
        }

        builder.Append("endsolid ").AppendLine(SanitizeName(solidName));
        return Encoding.UTF8.GetBytes(builder.ToString());
    }

    private static void WriteFacet(StringBuilder builder, Mesh mesh, Vector3f normal, int a, int b, int c)
    {
        builder.Append("  facet normal ");
        AppendNumber(builder, normal.X);
        builder.Append(' ');
        AppendNumber(builder, normal.Y);
        builder.Append(' ');
        AppendNumber(builder, normal.Z);
        builder.AppendLine();
        builder.AppendLine("    outer loop");
        WriteVertex(builder, mesh.Vertices[a]);
        WriteVertex(builder, mesh.Vertices[b]);
        WriteVertex(builder, mesh.Vertices[c]);
        builder.AppendLine("    endloop");
        builder.AppendLine("  endfacet");
    }

    private static void WriteVertex(StringBuilder builder, Point3f point)
    {
        builder.Append("      vertex ");
        AppendNumber(builder, point.X);
        builder.Append(' ');
        AppendNumber(builder, point.Y);
        builder.Append(' ');
        AppendNumber(builder, point.Z);
        builder.AppendLine();
    }

    private static void AppendNumber(StringBuilder builder, double value)
    {
        builder.Append(value.ToString("G17", CultureInfo.InvariantCulture));
    }

    private static string SanitizedFallback => "opencam_stock";

    private static string SanitizeName(string value)
    {
        var trimmed = string.IsNullOrWhiteSpace(value) ? SanitizedFallback : value.Trim();
        return new string(trimmed.Select(ch => char.IsLetterOrDigit(ch) || ch == '_' || ch == '-' ? ch : '_').ToArray());
    }
}
