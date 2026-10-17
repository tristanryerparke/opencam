// Integration target for the generated OpenCamRhinoBridge C# project.
// This stays deliberately small: Python owns every CAM/Rhino operation.
using System.Text.Json;

namespace OpenCamRhinoBridge;

internal static class PanelMessageBridge
{
    // Call this from Eto WebView.MessageReceived on Rhino's UI thread.
    // ProjectPlugin.RunPythonJson must create Rhino's Python 3 service, prepend
    // PluginBridge.PythonRoot, invoke the expression, and return its string.
    internal static string Dispatch(uint documentSerialNumber, string requestJson)
    {
        var quoted = JsonSerializer.Serialize(requestJson);
        return ProjectPlugin.RunPythonJson(
            "from opencam_rhino.entry import handle_panel_message\n"
            + "__opencam_result__ = handle_panel_message("
            + documentSerialNumber + ", " + quoted + ")\n",
            "__opencam_result__");
    }
}
