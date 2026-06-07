namespace OpenCamRhinoPlugin.Services;

public sealed class OpenCamPreset
{
    public double ToolDiameter { get; init; } = 12.0;
    public double CuttingHeight { get; init; } = 30.0;
    public double ZStepHeight { get; init; } = 6.0;
    public double Stepover { get; init; } = 50.0;
    public double StockToLeave { get; init; } = 0.0;
    public double Feedrate { get; init; } = 1000.0;
    public int Rpm { get; init; } = 12000;
    public double ClearanceOffset { get; init; } = 25.4;
    public double MaxSimDistance { get; init; } = 30.0;
    public double ChunkPaddingX { get; init; } = 5.0;
    public double ChunkPaddingY { get; init; } = 5.0;
    public double ChunkPaddingZ { get; init; } = 1.0;

    public static OpenCamPreset Default { get; } = new();
}
