namespace OpenCamRhinoPlugin.Bridge;

public sealed class WebBridgeReply
{
    public string? Id { get; init; }
    public string Type { get; init; } = string.Empty;
    public bool Ok { get; init; }
    public object? Data { get; init; }
    public string? Error { get; init; }
}
