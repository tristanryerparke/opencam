using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Eto.Drawing;
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
    private static readonly Regex StylesheetHrefRegex = new(
        "<link\\b[^>]*rel=\"stylesheet\"[^>]*href=\"(?<href>[^\"]+)\"[^>]*>",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex ScriptSrcRegex = new(
        "<script\\b[^>]*src=\"(?<src>[^\"]+)\"[^>]*>\\s*</script>",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Uri DevFrontendUri = new("http://localhost:5174/");

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
        _webView.DocumentLoaded += OnDocumentLoaded;
        RhinoApp.AppSettingsChanged += OnRhinoAppSettingsChanged;

        LogUi("Panel created", new { documentSerialNumber = _documentSerialNumber });
        TrySetBrowserContextMenuEnabled(_webView, false);
        LoadFrontend();
        Content = _webView;
    }

    public static Guid PanelId => typeof(OpenCamPanel).GUID;

    public void PanelShown(uint documentSerialNumber, ShowPanelReason reason)
    {
        LogUi("Panel shown", new { documentSerialNumber, reason = reason.ToString() });
        PostEvent("panelShown", new { documentSerialNumber });
    }

    public void PanelHidden(uint documentSerialNumber, ShowPanelReason reason)
    {
    }

    public void PanelClosing(uint documentSerialNumber, bool onCloseDocument)
    {
        LogUi("Panel closing", new { documentSerialNumber, onCloseDocument });
        RhinoApp.AppSettingsChanged -= OnRhinoAppSettingsChanged;
        _toolpathPreview.Clear();
        _simulationPreview.Clear();
    }

    private void OnDocumentLoaded(object? sender, WebViewLoadedEventArgs e)
    {
        LogUi("WebView document loaded", new
        {
            documentSerialNumber = _documentSerialNumber,
            uri = e.Uri?.ToString(),
            ready = true,
        });

        PostEvent("rhinoReady", new
        {
            documentSerialNumber = _documentSerialNumber,
            rhinoVersion = RhinoApp.Version.ToString(),
        });
        SyncRhinoThemeToWebView();
    }

    private void OnRhinoAppSettingsChanged(object? sender, EventArgs e)
    {
        SyncRhinoThemeToWebView();
    }

    private void OnDocumentLoading(object? sender, WebViewLoadingEventArgs e)
    {
        if (!string.Equals(e.Uri.Scheme, "rhino", StringComparison.OrdinalIgnoreCase))
        {
            if (e.Uri != null)
            {
                LogUi("WebView loading", new { uri = e.Uri.ToString() });
            }
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
                case "uiDebug":
                    LogUi("Frontend debug", message.Payload.ValueKind == JsonValueKind.Undefined ? null : message.Payload);
                    if (!string.IsNullOrWhiteSpace(message.Id))
                    {
                        PostReply(message, new { logged = true });
                    }
                    break;
                case "uiError":
                    LogUiError("Frontend error", message.Payload.ValueKind == JsonValueKind.Undefined ? null : message.Payload);
                    if (!string.IsNullOrWhiteSpace(message.Id))
                    {
                        PostReply(message, new { logged = true });
                    }
                    break;
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
        var backendUrl = ReadString(message.Payload, "backendUrl") ?? "http://127.0.0.1:9090";
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

    private void SyncRhinoThemeToWebView()
    {
        try
        {
            var systemBackground = SystemColors.ControlBackground;
            var isDark = RelativeLuminance(systemBackground) < 0.5;
            var script = "window.__setRhinoTheme && window.__setRhinoTheme({"
                + $"isDark:{(isDark ? "true" : "false")}"
                + "});";
            ExecuteJavaScript(script);
            LogUi("Synced Rhino theme", new
            {
                isDark,
            });
        }
        catch (Exception ex)
        {
            LogUiError("SyncRhinoThemeToWebView failed", new { ex.Message, ex.StackTrace });
        }
    }

    private static double RelativeLuminance(Color color)
    {
        return (0.2126 * color.Rb + 0.7152 * color.Gb + 0.0722 * color.Bb) / 255.0;
    }

    private static void LogUi(string message, object? data = null)
    {
        var suffix = data == null ? string.Empty : " :: " + SerializeForLog(data);
        RhinoApp.WriteLine($"[OpenCAM:UI] {message}{suffix}");
    }

    private static void LogUiError(string message, object? data = null)
    {
        var suffix = data == null ? string.Empty : " :: " + SerializeForLog(data);
        RhinoApp.WriteLine($"[OpenCAM:UI:ERROR] {message}{suffix}");
    }

    private static string SerializeForLog(object data)
    {
        try
        {
            return data is JsonElement element
                ? element.GetRawText()
                : JsonSerializer.Serialize(data, JsonOptions);
        }
        catch (Exception ex)
        {
            return "<unserializable: " + ex.Message + ">";
        }
    }

    private void ExecuteJavaScript(string script)
    {
        Application.Instance.AsyncInvoke(() =>
        {
            try
            {
                var asyncMethod = _webView.GetType().GetMethod("ExecuteScriptAsync", new[] { typeof(string) });
                if (asyncMethod != null)
                {
                    asyncMethod.Invoke(_webView, new object[] { script });
                    return;
                }

                _webView.ExecuteScript(script);
            }
            catch (Exception ex)
            {
                LogUiError("ExecuteJavaScript failed", new { ex.Message, ex.StackTrace });
            }
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

    private void LoadFrontend()
    {
        var indexPath = ResolvePanelIndexPath();
        var bundledFrontendExists = File.Exists(indexPath);
        LogUi("Resolving frontend", new { indexPath, exists = bundledFrontendExists });

        if (TryLoadDevFrontend())
        {
            return;
        }

        if (!bundledFrontendExists)
        {
            throw new FileNotFoundException("OpenCAM frontend bundle not found.", indexPath);
        }

        var html = File.ReadAllText(indexPath);
        html = InlineFrontendAssets(html, indexPath);

        var bootstrapJson = JsonSerializer.Serialize(new
        {
            mode = "panel",
            backendUrl = "http://127.0.0.1:9090",
        }, JsonOptions);
        var bootstrapScript = BuildBootstrapScript(bootstrapJson);
        var htmlWithBootstrap = html.Contains("</head>", StringComparison.OrdinalIgnoreCase)
            ? html.Replace("</head>", bootstrapScript + "</head>", StringComparison.OrdinalIgnoreCase)
            : bootstrapScript + html;

        LogUi("Loading bundled frontend", new
        {
            indexPath,
            htmlLength = html.Length,
            injectedHtmlLength = htmlWithBootstrap.Length,
        });

        _webView.LoadHtml(htmlWithBootstrap, new Uri(indexPath));
    }

    private bool TryLoadDevFrontend()
    {
        try
        {
            using var httpClient = new HttpClient
            {
                Timeout = TimeSpan.FromMilliseconds(750),
            };
            using var request = new HttpRequestMessage(HttpMethod.Get, DevFrontendUri);
            using var response = httpClient.Send(request);
            if (!response.IsSuccessStatusCode)
            {
                LogUi("Dev frontend unavailable", new
                {
                    url = DevFrontendUri.ToString(),
                    statusCode = (int)response.StatusCode,
                });
                return false;
            }

            LogUi("Loading dev frontend", new { url = DevFrontendUri.ToString() });
            _webView.Url = DevFrontendUri;
            return true;
        }
        catch (Exception ex)
        {
            LogUi("Dev frontend unavailable", new
            {
                url = DevFrontendUri.ToString(),
                error = ex.Message,
            });
            return false;
        }
    }

    private string InlineFrontendAssets(string html, string indexPath)
    {
        var indexDirectory = Path.GetDirectoryName(indexPath) ?? AppContext.BaseDirectory;
        var inlinedStylesheetCount = 0;
        var inlinedScriptCount = 0;

        html = StylesheetHrefRegex.Replace(html, match =>
        {
            var href = match.Groups["href"].Value;
            var assetPath = ResolveFrontendAssetPath(indexDirectory, href);
            if (!File.Exists(assetPath))
            {
                LogUiError("Stylesheet asset missing", new { href, assetPath });
                return match.Value;
            }

            inlinedStylesheetCount += 1;
            return "<style data-opencam-inline=\"" + Path.GetFileName(assetPath) + "\">\n"
                + File.ReadAllText(assetPath)
                + "\n</style>";
        });

        html = ScriptSrcRegex.Replace(html, match =>
        {
            var src = match.Groups["src"].Value;
            var assetPath = ResolveFrontendAssetPath(indexDirectory, src);
            if (!File.Exists(assetPath))
            {
                LogUiError("Script asset missing", new { src, assetPath });
                return match.Value;
            }

            var originalTag = match.Value;
            var typeAttribute = originalTag.Contains("type=\"module\"", StringComparison.OrdinalIgnoreCase)
                ? " type=\"module\""
                : string.Empty;

            inlinedScriptCount += 1;
            return "<script" + typeAttribute + ">\n"
                + File.ReadAllText(assetPath)
                + "\n</script>";
        });

        LogUi("Inlined frontend assets", new
        {
            indexDirectory,
            inlinedStylesheetCount,
            inlinedScriptCount,
        });

        return html;
    }

    private static string ResolveFrontendAssetPath(string indexDirectory, string relativePath)
    {
        var normalizedRelativePath = relativePath.Replace('/', Path.DirectorySeparatorChar)
            .TrimStart(Path.DirectorySeparatorChar);
        if (normalizedRelativePath.StartsWith("." + Path.DirectorySeparatorChar, StringComparison.Ordinal))
        {
            normalizedRelativePath = normalizedRelativePath[(2)..];
        }

        return Path.GetFullPath(Path.Combine(indexDirectory, normalizedRelativePath));
    }

    private static string BuildBootstrapScript(string bootstrapJson)
    {
        return "<script>\n"
            + "window.__OPENCAM_BOOTSTRAP__ = " + bootstrapJson + ";\n"
            + "window.__openCamRhinoDebug = function(level, message, data) {\n"
            + "  try {\n"
            + "    var payload = {\n"
            + "      type: level === 'error' ? 'uiError' : 'uiDebug',\n"
            + "      payload: {\n"
            + "        level: level || 'info',\n"
            + "        message: message || '',\n"
            + "        data: data ?? null,\n"
            + "        href: window.location.href,\n"
            + "        readyState: document.readyState\n"
            + "      }\n"
            + "    };\n"
            + "    window.location.href = 'rhino://message?' + encodeURIComponent(JSON.stringify(payload));\n"
            + "  } catch (_) {}\n"
            + "};\n"
            + "window.__openCamRhinoDebug('info', 'bootstrap injected', window.__OPENCAM_BOOTSTRAP__);\n"
            + "window.addEventListener('DOMContentLoaded', function() {\n"
            + "  window.__openCamRhinoDebug('info', 'dom content loaded');\n"
            + "});\n"
            + "window.addEventListener('load', function() {\n"
            + "  window.__openCamRhinoDebug('info', 'window load fired');\n"
            + "});\n"
            + "window.addEventListener('error', function(event) {\n"
            + "  window.__openCamRhinoDebug('error', 'window error', {\n"
            + "    message: event.message,\n"
            + "    source: event.filename,\n"
            + "    line: event.lineno,\n"
            + "    column: event.colno,\n"
            + "    error: event.error ? String(event.error.stack || event.error.message || event.error) : null\n"
            + "  });\n"
            + "});\n"
            + "window.addEventListener('unhandledrejection', function(event) {\n"
            + "  var reason = event.reason;\n"
            + "  window.__openCamRhinoDebug('error', 'unhandled rejection', {\n"
            + "    reason: reason ? String(reason.stack || reason.message || reason) : null\n"
            + "  });\n"
            + "});\n"
            + "</script>\n";
    }

    private static string ResolvePanelIndexPath()
    {
        var pluginDir = Path.GetDirectoryName(typeof(OpenCamPanel).Assembly.Location)
            ?? AppContext.BaseDirectory;
        return Path.Combine(pluginDir, "panel-web", "index.html");
    }
}
