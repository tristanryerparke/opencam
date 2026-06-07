using System.Reflection;
using System.Text.Json;
using Eto.Forms;
using Rhino;
using Rhino.Geometry;
using Rhino.UI;
using OpenCamRhinoPlugin.Bridge;
using OpenCamRhinoPlugin.Display;
using OpenCamRhinoPlugin.Services;

namespace OpenCamRhinoPlugin.Panels;

[System.Runtime.InteropServices.Guid("8001aab4-2835-43b4-8584-9c54dd72afc6")]
public sealed class OpenCamPanel : Panel, IPanel
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false,
    };

    private readonly uint _documentSerialNumber;
    private readonly WebView _webView;
    private readonly RhinoSelectionService _selectionService = new();
    private readonly ToolpathPreviewConduit _toolpathPreview = new();
    private readonly SimulationPreviewConduit _simulationPreview = new();
    private readonly OpenCamPreset _preset = OpenCamPreset.Default;

    private SelectedStock? _selectedStock;
    private SelectedPocketBoundary? _selectedBoundary;
    private string? _operationJson;

    public OpenCamPanel(uint documentSerialNumber)
    {
        _documentSerialNumber = documentSerialNumber;
        _webView = new WebView();
        _webView.DocumentLoading += OnDocumentLoading;
        _webView.DocumentLoaded += (_, _) => PostEvent("rhinoReady", new
        {
            documentSerialNumber = _documentSerialNumber,
            rhinoVersion = RhinoApp.Version.ToString(),
        });

        TrySetBrowserContextMenuEnabled(_webView, false);
        _webView.Url = ResolvePanelUrl();
        Content = _webView;
    }

    public static Guid PanelId => typeof(OpenCamPanel).GUID;

    public void PanelShown(uint documentSerialNumber, ShowPanelReason reason)
    {
        PostEvent("panelShown", new { documentSerialNumber });
    }

    public void PanelHidden(uint documentSerialNumber, ShowPanelReason reason)
    {
    }

    public void PanelClosing(uint documentSerialNumber, bool onCloseDocument)
    {
        _toolpathPreview.Clear();
        _simulationPreview.Clear();
    }

    private void OnDocumentLoading(object? sender, WebViewLoadingEventArgs e)
    {
        if (!string.Equals(e.Uri.Scheme, "rhino", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        e.Cancel = true;
        var payload = Uri.UnescapeDataString(e.Uri.Query.TrimStart('?'));
        if (string.IsNullOrWhiteSpace(payload))
        {
            return;
        }

        WebBridgeMessage? message;
        try
        {
            message = JsonSerializer.Deserialize<WebBridgeMessage>(payload, JsonOptions);
        }
        catch (JsonException ex)
        {
            PostReply(new WebBridgeReply
            {
                Type = "invalidMessage",
                Ok = false,
                Error = ex.Message,
            });
            return;
        }

        if (message == null || string.IsNullOrWhiteSpace(message.Type))
        {
            PostReply(new WebBridgeReply
            {
                Id = message?.Id,
                Type = message?.Type ?? "invalidMessage",
                Ok = false,
                Error = "Bridge message is missing a type.",
            });
            return;
        }

        DispatchMessage(message);
    }

    private void DispatchMessage(WebBridgeMessage message)
    {
        try
        {
            switch (message.Type)
            {
                case "ping":
                    PostReply(message, new
                    {
                        documentSerialNumber = _documentSerialNumber,
                        rhinoVersion = RhinoApp.Version.ToString(),
                        hasStock = _selectedStock != null,
                        hasBoundary = _selectedBoundary != null,
                        hasOperation = _operationJson != null,
                    });
                    break;
                case "selectStock":
                    SelectStock(message);
                    break;
                case "selectPocketBoundary":
                    SelectPocketBoundary(message);
                    break;
                case "testBackend":
                    RunBackendTask(message, async (client, cancellationToken) =>
                    {
                        using var ping = await client.PingAsync(cancellationToken).ConfigureAwait(false);
                        return ping.RootElement.Clone();
                    });
                    break;
                case "generateToolpath":
                    GenerateToolpath(message);
                    break;
                case "startSimulation":
                    StartSimulation(message);
                    break;
                case "pollSimulation":
                    PollSimulation(message);
                    break;
                case "clearPreview":
                    _toolpathPreview.Clear();
                    _simulationPreview.Clear();
                    RhinoDoc.ActiveDoc?.Views.Redraw();
                    PostReply(message, new { cleared = true });
                    break;
                default:
                    PostReply(new WebBridgeReply
                    {
                        Id = message.Id,
                        Type = message.Type,
                        Ok = false,
                        Error = "Unsupported bridge message type: " + message.Type,
                    });
                    break;
            }
        }
        catch (Exception ex)
        {
            PostReply(new WebBridgeReply
            {
                Id = message.Id,
                Type = message.Type,
                Ok = false,
                Error = ex.Message,
            });
        }
    }

    private void SelectStock(WebBridgeMessage message)
    {
        var doc = RhinoDoc.ActiveDoc ?? throw new InvalidOperationException("No active Rhino document.");
        var stock = _selectionService.SelectStock(doc);
        if (stock == null)
        {
            PostReply(new WebBridgeReply
            {
                Id = message.Id,
                Type = message.Type,
                Ok = false,
                Error = "Stock selection cancelled.",
            });
            return;
        }

        _selectedStock = stock;
        _operationJson = null;
        _simulationPreview.Clear();
        PostReply(message, new
        {
            stock.ObjectId,
            stock.Name,
            stock.VertexCount,
            stock.FaceCount,
            stlByteCount = stock.StlBytes.Length,
            bounds = BoundsDto(stock.Bounds),
        });
    }

    private void SelectPocketBoundary(WebBridgeMessage message)
    {
        var doc = RhinoDoc.ActiveDoc ?? throw new InvalidOperationException("No active Rhino document.");
        var boundary = _selectionService.SelectPocketBoundary(doc);
        if (boundary == null)
        {
            PostReply(new WebBridgeReply
            {
                Id = message.Id,
                Type = message.Type,
                Ok = false,
                Error = "Pocket boundary selection cancelled.",
            });
            return;
        }

        _selectedBoundary = boundary;
        _operationJson = null;
        _simulationPreview.Clear();
        PostReply(message, new
        {
            boundary.ObjectId,
            boundary.SourceKind,
            boundary.PlaneZ,
            pointCount = boundary.Polyline.Count,
        });
    }

    private void GenerateToolpath(WebBridgeMessage message)
    {
        if (_selectedStock == null)
        {
            throw new InvalidOperationException("Select stock before generating a toolpath.");
        }
        if (_selectedBoundary == null)
        {
            throw new InvalidOperationException("Select a pocket boundary before generating a toolpath.");
        }

        var requestJson = OperationRequestBuilder.BuildClosedPocketRequest(_selectedBoundary, _selectedStock, _preset);
        RunBackendTask(message, async (client, cancellationToken) =>
        {
            var operationJson = await client.GenerateClosedPocketAsync(requestJson, cancellationToken).ConfigureAwait(false);
            _operationJson = operationJson;

            RhinoApp.InvokeOnUiThread((Action)(() =>
            {
                _simulationPreview.Clear();
                _toolpathPreview.LoadOperationJson(operationJson);
                RhinoDoc.ActiveDoc?.Views.Redraw();
            }));

            using var operationDocument = JsonDocument.Parse(operationJson);
            return new
            {
                operation = operationDocument.RootElement.Clone(),
                previewCurveCount = _toolpathPreview.CurveCount,
                previewPointCount = _toolpathPreview.PointCount,
            };
        });
    }

    private void StartSimulation(WebBridgeMessage message)
    {
        if (_selectedStock == null)
        {
            throw new InvalidOperationException("Select stock before starting simulation.");
        }
        if (string.IsNullOrWhiteSpace(_operationJson))
        {
            throw new InvalidOperationException("Generate a toolpath before starting simulation.");
        }

        RunBackendTask(message, async (client, cancellationToken) =>
        {
            var startJson = await client.StartSweptSimulationAsync(
                _selectedStock.StlBytes,
                "rhino-stock.stl",
                _operationJson,
                _preset,
                cancellationToken).ConfigureAwait(false);

            using var startDocument = JsonDocument.Parse(startJson);
            return startDocument.RootElement.Clone();
        });
    }

    private void PollSimulation(WebBridgeMessage message)
    {
        var taskId = ReadString(message.Payload, "taskId");
        if (string.IsNullOrWhiteSpace(taskId))
        {
            throw new InvalidOperationException("pollSimulation requires payload.taskId.");
        }

        RunBackendTask(message, async (client, cancellationToken) =>
        {
            var statusJson = await client.GetSimulationStatusAsync(taskId, cancellationToken).ConfigureAwait(false);
            using var statusDocument = JsonDocument.Parse(statusJson);
            var status = statusDocument.RootElement.Clone();
            var rhinoPreviewLoaded = await TryLoadCompletedSimulationPreviewAsync(client, status, cancellationToken).ConfigureAwait(false);
            return new
            {
                status,
                rhinoPreviewLoaded,
            };
        });
    }

    private async Task<bool> TryLoadCompletedSimulationPreviewAsync(
        OpenCamBackendClient client,
        JsonElement status,
        CancellationToken cancellationToken)
    {
        if (!status.TryGetProperty("status", out var statusValue)
            || !string.Equals(statusValue.GetString(), "completed", StringComparison.OrdinalIgnoreCase)
            || !status.TryGetProperty("result", out var result)
            || result.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        var activeMeshUrl = ReadString(result, "activeMeshUrl");
        var cachedMeshUrl = ReadString(result, "cachedMeshUrl");
        var toolMeshUrl = ReadString(result, "toolMeshUrl");
        if (string.IsNullOrWhiteSpace(activeMeshUrl) || string.IsNullOrWhiteSpace(cachedMeshUrl))
        {
            return false;
        }

        var activeMeshJson = await client.GetRhinoMeshJsonAsync(ToRhinoMeshJsonUrl(activeMeshUrl), cancellationToken).ConfigureAwait(false);
        var cachedMeshJson = await client.GetRhinoMeshJsonAsync(ToRhinoMeshJsonUrl(cachedMeshUrl), cancellationToken).ConfigureAwait(false);
        string? toolMeshJson = null;
        if (!string.IsNullOrWhiteSpace(toolMeshUrl))
        {
            toolMeshJson = await client.GetRhinoMeshJsonAsync(ToRhinoMeshJsonUrl(toolMeshUrl), cancellationToken).ConfigureAwait(false);
        }

        var toolPosition = Point3d.Origin;
        if (result.TryGetProperty("toolPosition", out var toolPositionElement))
        {
            toolPosition = ReadPoint3d(toolPositionElement);
        }

        RhinoApp.InvokeOnUiThread((Action)(() =>
        {
            var activeMesh = DecodeRhinoMeshJson(activeMeshJson, "active simulation mesh");
            var cachedMesh = DecodeRhinoMeshJson(cachedMeshJson, "cached simulation mesh");
            var toolMesh = string.IsNullOrWhiteSpace(toolMeshJson)
                ? null
                : DecodeRhinoMeshJson(toolMeshJson, "tool mesh");
            _simulationPreview.LoadFrame(cachedMesh, activeMesh, toolMesh, toolPosition);
            RhinoDoc.ActiveDoc?.Views.Redraw();
        }));

        return true;
    }

    private static string ToRhinoMeshJsonUrl(string meshUrl)
    {
        return meshUrl.EndsWith(".glb", StringComparison.OrdinalIgnoreCase)
            ? meshUrl[..^4] + ".rhino.json"
            : meshUrl;
    }

    private static Mesh DecodeRhinoMeshJson(string json, string label)
    {
        var commonObject = Rhino.Runtime.CommonObject.FromJSON(json);
        if (commonObject is Mesh mesh && mesh.IsValid)
        {
            if (mesh.Normals.Count == 0)
            {
                mesh.Normals.ComputeNormals();
            }
            mesh.Compact();
            return mesh;
        }

        throw new InvalidOperationException($"Backend returned invalid {label}.");
    }

    private static Point3d ReadPoint3d(JsonElement element)
    {
        if (!element.TryGetProperty("x", out var x)
            || !element.TryGetProperty("y", out var y)
            || !element.TryGetProperty("z", out var z))
        {
            return Point3d.Origin;
        }

        return new Point3d(x.GetDouble(), y.GetDouble(), z.GetDouble());
    }

    private void RunBackendTask(WebBridgeMessage message, Func<OpenCamBackendClient, CancellationToken, Task<object?>> action)
    {
        var backendUrl = ReadString(message.Payload, "backendUrl") ?? "http://localhost:8000";
        _ = Task.Run(async () =>
        {
            try
            {
                var client = new OpenCamBackendClient(backendUrl);
                var data = await action(client, CancellationToken.None).ConfigureAwait(false);
                PostReply(message, data);
            }
            catch (Exception ex)
            {
                PostReply(new WebBridgeReply
                {
                    Id = message.Id,
                    Type = message.Type,
                    Ok = false,
                    Error = ex.Message,
                });
            }
        });
    }

    private static object BoundsDto(Rhino.Geometry.BoundingBox bounds)
    {
        return new
        {
            min = new { x = bounds.Min.X, y = bounds.Min.Y, z = bounds.Min.Z },
            max = new { x = bounds.Max.X, y = bounds.Max.Y, z = bounds.Max.Z },
        };
    }

    private static string? ReadString(JsonElement payload, string name)
    {
        if (payload.ValueKind == JsonValueKind.Object
            && payload.TryGetProperty(name, out var element)
            && element.ValueKind == JsonValueKind.String)
        {
            return element.GetString();
        }

        return null;
    }

    private void PostReply(WebBridgeMessage message, object? data)
    {
        PostReply(new WebBridgeReply
        {
            Id = message.Id,
            Type = message.Type,
            Ok = true,
            Data = data,
        });
    }

    private void PostEvent(string type, object? data)
    {
        PostReply(new WebBridgeReply
        {
            Type = type,
            Ok = true,
            Data = data,
        });
    }

    private void PostReply(WebBridgeReply reply)
    {
        var json = JsonSerializer.Serialize(reply, JsonOptions);
        ExecuteJavaScript("window.__openCamBridge && window.__openCamBridge.receive(" + json + ");");
    }

    private void ExecuteJavaScript(string script)
    {
        Application.Instance.AsyncInvoke(() =>
        {
            var asyncMethod = _webView.GetType().GetMethod("ExecuteScriptAsync", new[] { typeof(string) });
            if (asyncMethod != null)
            {
                asyncMethod.Invoke(_webView, new object[] { script });
                return;
            }

            _webView.ExecuteScript(script);
        });
    }

    private static void TrySetBrowserContextMenuEnabled(WebView webView, bool enabled)
    {
        var property = webView.GetType().GetProperty("BrowserContextMenuEnabled", BindingFlags.Instance | BindingFlags.Public);
        if (property?.CanWrite == true)
        {
            property.SetValue(webView, enabled);
        }
    }

    private static Uri ResolvePanelUrl()
    {
#if DEBUG
        return new Uri("http://localhost:5174/");
#else
        var pluginDir = Path.GetDirectoryName(typeof(OpenCamPanel).Assembly.Location)
            ?? AppContext.BaseDirectory;
        var indexPath = Path.Combine(pluginDir, "web", "index.html");
        return new Uri(indexPath);
#endif
    }
}
