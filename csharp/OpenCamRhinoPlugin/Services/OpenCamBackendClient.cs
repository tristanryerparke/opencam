using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace OpenCamRhinoPlugin.Services;

public sealed class OpenCamBackendClient
{
    private static readonly HttpClient SharedHttpClient = new()
    {
        Timeout = TimeSpan.FromMinutes(10),
    };

    private readonly Uri _baseUri;

    public OpenCamBackendClient(string baseUrl)
    {
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            baseUrl = "http://localhost:8000";
        }

        _baseUri = new Uri(baseUrl.TrimEnd('/') + "/");
    }

    public async Task<JsonDocument> PingAsync(CancellationToken cancellationToken = default)
    {
        using var response = await SharedHttpClient.GetAsync(new Uri(_baseUri, "ping"), cancellationToken).ConfigureAwait(false);
        return await ReadJsonResponse(response, cancellationToken).ConfigureAwait(false);
    }

    public async Task<string> GenerateClosedPocketAsync(string requestJson, CancellationToken cancellationToken = default)
    {
        using var content = new StringContent(requestJson, Encoding.UTF8, "application/json");
        using var response = await SharedHttpClient.PostAsync(new Uri(_baseUri, "pocket/closed"), content, cancellationToken).ConfigureAwait(false);
        return await ReadTextResponse(response, cancellationToken).ConfigureAwait(false);
    }

    public async Task<string> StartSweptSimulationAsync(
        byte[] stlBytes,
        string stlName,
        string operationJson,
        OpenCamPreset preset,
        CancellationToken cancellationToken = default)
    {
        using var form = new MultipartFormDataContent();
        var meshContent = new ByteArrayContent(stlBytes);
        meshContent.Headers.ContentType = new MediaTypeHeaderValue("model/stl");
        form.Add(meshContent, "mesh", string.IsNullOrWhiteSpace(stlName) ? "stock.stl" : stlName);
        form.Add(new StringContent(operationJson, Encoding.UTF8), "operation");
        form.Add(new StringContent(preset.MaxSimDistance.ToString(System.Globalization.CultureInfo.InvariantCulture)), "max_sim_distance");
        form.Add(new StringContent(preset.ChunkPaddingX.ToString(System.Globalization.CultureInfo.InvariantCulture)), "chunk_padding_x");
        form.Add(new StringContent(preset.ChunkPaddingY.ToString(System.Globalization.CultureInfo.InvariantCulture)), "chunk_padding_y");
        form.Add(new StringContent(preset.ChunkPaddingZ.ToString(System.Globalization.CultureInfo.InvariantCulture)), "chunk_padding_z");

        using var response = await SharedHttpClient.PostAsync(new Uri(_baseUri, "simulate/swept"), form, cancellationToken).ConfigureAwait(false);
        return await ReadTextResponse(response, cancellationToken).ConfigureAwait(false);
    }

    public async Task<string> GetSimulationStatusAsync(string taskId, CancellationToken cancellationToken = default)
    {
        using var response = await SharedHttpClient.GetAsync(new Uri(_baseUri, $"simulate/swept/{Uri.EscapeDataString(taskId)}/status"), cancellationToken).ConfigureAwait(false);
        return await ReadTextResponse(response, cancellationToken).ConfigureAwait(false);
    }

    public async Task<string> GetRhinoMeshJsonAsync(string relativeUrl, CancellationToken cancellationToken = default)
    {
        var normalizedUrl = relativeUrl.TrimStart('/');
        using var response = await SharedHttpClient.GetAsync(new Uri(_baseUri, normalizedUrl), cancellationToken).ConfigureAwait(false);
        return await ReadTextResponse(response, cancellationToken).ConfigureAwait(false);
    }

    private static async Task<JsonDocument> ReadJsonResponse(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var text = await ReadTextResponse(response, cancellationToken).ConfigureAwait(false);
        return JsonDocument.Parse(text);
    }

    private static async Task<string> ReadTextResponse(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (response.IsSuccessStatusCode)
        {
            return text;
        }

        string detail = text;
        try
        {
            using var document = JsonDocument.Parse(text);
            if (document.RootElement.TryGetProperty("detail", out var detailElement))
            {
                detail = detailElement.ToString();
            }
        }
        catch (JsonException)
        {
            // Keep raw response text.
        }

        throw new HttpRequestException($"OpenCAM backend returned {(int)response.StatusCode}: {detail}");
    }
}
