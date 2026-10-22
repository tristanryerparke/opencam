namespace OpenCamRhinoBridge
{
  /// <summary>Python-visible services owned by the minimal C# shim.</summary>
  public static class PluginBridge
  {
    public static bool IsDevelopmentMode =>
      RhinoCodePlatform.Rhino3D.Projects.Plugin.ProjectPlugin.IsDevelopmentMode;

    public static string PythonRoot =>
      RhinoCodePlatform.Rhino3D.Projects.Plugin.ProjectPlugin.PythonRoot;

    public static string GetDocumentDataJson(uint documentSerialNumber)
    {
      return RhinoCodePlatform.Rhino3D.Projects.Plugin.ProjectPlugin
        .GetDocumentDataJson(documentSerialNumber);
    }

    public static bool SetDocumentDataJson(uint documentSerialNumber, string json)
    {
      return RhinoCodePlatform.Rhino3D.Projects.Plugin.ProjectPlugin
        .SetDocumentDataJson(documentSerialNumber, json);
    }

    public static string ShowOperationDialog(uint documentSerialNumber,
      string initialJson)
    {
      return RhinoCodePlatform.Rhino3D.Projects.Plugin.OpenCamOperationDialog
        .Show(documentSerialNumber, initialJson);
    }

    public static int ReloadPanel(uint documentSerialNumber)
    {
      var panels = Rhino.UI.Panels.GetPanels(
        RhinoCodePlatform.Rhino3D.Projects.Plugin.OpenCamWebPanel.PanelId,
        documentSerialNumber);
      var reloaded = 0;
      foreach (var panel in panels)
      {
        var openCamPanel = panel as RhinoCodePlatform.Rhino3D.Projects.Plugin.OpenCamWebPanel;
        if (openCamPanel == null)
          continue;
        openCamPanel.ReloadPage();
        reloaded += 1;
      }
      return reloaded;
    }
  }

  /// <summary>Explicit synchronous return channel from Rhino CPython to C#.</summary>
  public static class PanelResponseSink
  {
    static string s_value;

    public static void Clear() => s_value = null;
    public static void Set(string value) => s_value = value;
    public static string Take()
    {
      var value = s_value;
      s_value = null;
      return value;
    }
  }
}
