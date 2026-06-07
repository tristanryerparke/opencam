using System.Text.Json;
using System.Text.Json.Serialization;

namespace OpenCamRhinoPlugin.Bridge;

public sealed class WebBridgeMessage
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("payload")]
    public JsonElement Payload { get; set; }
}
