using System;
using System.Text;

namespace RhinoCodePlatform.Rhino3D.Projects.Plugin
{
  internal static class PanelMessageBridge
  {
    internal static string Dispatch(uint documentSerialNumber, string requestJson)
    {
      var request = Convert.ToBase64String(
        Encoding.UTF8.GetBytes(requestJson ?? "{}"));
      return ProjectPlugin.RunPythonJson(
        "import base64\nfrom opencam_rhino.entry import handle_panel_message\n"
        + "__opencam_result__ = handle_panel_message("
        + documentSerialNumber + ", base64.b64decode(\"" + request
        + "\").decode(\"utf-8\"))\n", 
        "__opencam_result__",
        "OpenCAM panel action failed");
    }
  }
}
