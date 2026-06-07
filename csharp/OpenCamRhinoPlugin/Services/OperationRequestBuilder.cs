using System.Text.Json;

namespace OpenCamRhinoPlugin.Services;

public static class OperationRequestBuilder
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false,
    };

    public static string BuildClosedPocketRequest(
        SelectedPocketBoundary boundary,
        SelectedStock stock,
        OpenCamPreset preset)
    {
        var stockTopZ = stock.Bounds.Max.Z;
        var pocketZ = boundary.PlaneZ;
        var clearancePlane = Math.Max(stockTopZ, pocketZ) + preset.ClearanceOffset;

        var vertices = boundary.Polyline.Select(point => new
        {
            x = point.X,
            y = point.Y,
        }).ToArray();

        var request = new
        {
            ring = new
            {
                vertices,
            },
            tool = new
            {
                diameter = preset.ToolDiameter,
                cuttingHeight = preset.CuttingHeight,
            },
            feedrate = preset.Feedrate,
            rpm = preset.Rpm,
            zBounds = new[] { pocketZ, stockTopZ },
            zStepHeight = preset.ZStepHeight,
            clearancePlaneHeight = clearancePlane,
            stockToLeave = preset.StockToLeave,
            stepover = preset.Stepover,
        };

        return JsonSerializer.Serialize(request, JsonOptions);
    }
}
