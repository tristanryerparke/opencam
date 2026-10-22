using System;
using System.IO;
using System.Text;

using Eto.Forms;

using Rhino.UI;

namespace RhinoCodePlatform.Rhino3D.Projects.Plugin
{
  /// <summary>Blocking TypeScript WebView operation editor; Python owns result handling.</summary>
  internal sealed class OpenCamOperationDialog : Dialog<bool>
  {
    readonly WebView m_view = new WebView();
    readonly LocalPageServer m_page;
    readonly string m_initialJson;
    string m_result = "{\"action\":\"cancel\"}";
    bool m_pageLoaded;

    static readonly Eto.Drawing.Size PickerSize = new Eto.Drawing.Size(560, 370);
    static readonly Eto.Drawing.Size EditorSize = new Eto.Drawing.Size(780, 440);

    OpenCamOperationDialog(string initialJson)
    {
      Title = WindowTitle(initialJson);
      ClientSize = IsPicker(initialJson) ? PickerSize : EditorSize;
      Resizable = false;
      Rhino.UI.EtoExtensions.UseRhinoStyle(this);
      m_view.BrowserContextMenuEnabled = false;
      Content = m_view;
      m_initialJson = initialJson ?? "{}";
      m_page = new LocalPageServer(Path.Combine(
        PluginDirectory(), "web", "dist", "operation-dialog.html"));
      m_view.MessageReceived += OnMessageReceived;
      m_view.DocumentLoaded += OnDocumentLoaded;
      ThemeSettings.ThemeChanged += OnThemeChanged;
      m_view.Url = m_page.PageUrl;
    }

    internal static string Show(uint documentSerialNumber, string initialJson)
    {
      using (var dialog = new OpenCamOperationDialog(initialJson))
      {
        var doc = Rhino.RhinoDoc.FromRuntimeSerialNumber(documentSerialNumber);
        var owner = doc != null ? RhinoEtoApp.MainWindowForDocument(doc) : null;
        if (owner == null)
          owner = RhinoEtoApp.MainWindow;
        dialog.ShowModal(owner);
        return dialog.m_result;
      }
    }

    protected override void Dispose(bool disposing)
    {
      if (disposing)
      {
        ThemeSettings.ThemeChanged -= OnThemeChanged;
        m_page.Dispose();
      }
      base.Dispose(disposing);
    }

    void OnDocumentLoaded(object sender, WebViewLoadedEventArgs eventArgs)
    {
      m_pageLoaded = true;
      ApplyTheme();
      var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(m_initialJson));
      _ = m_view.ExecuteScriptAsync(
        "window.opencamOperation && window.opencamOperation.initialize(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('"
        + encoded + "'), function(c) { return c.charCodeAt(0); }))));");
    }

    void OnThemeChanged(object sender, EventArgs eventArgs)
    {
      ApplyTheme();
    }

    void ApplyTheme()
    {
      if (!m_pageLoaded)
        return;
      var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(PanelTheme.Json()));
      _ = m_view.ExecuteScriptAsync(
        "window.opencamOperation && window.opencamOperation.theme(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('"
        + encoded + "'), function(c) { return c.charCodeAt(0); }))));");
    }

    void OnMessageReceived(object sender, WebViewMessageEventArgs eventArgs)
    {
      var message = eventArgs.Message;
      if (!string.IsNullOrWhiteSpace(message)
        && message.IndexOf("\"action\":\"resize_dialog\"", StringComparison.Ordinal) >= 0)
      {
        ClientSize = message.IndexOf("\"mode\":\"picker\"", StringComparison.Ordinal) >= 0
          ? PickerSize
          : EditorSize;
        return;
      }
      m_result = string.IsNullOrWhiteSpace(message)
        ? "{\"action\":\"cancel\"}"
        : message;
      Close();
    }

    static bool IsPicker(string initialJson)
    {
      return string.IsNullOrWhiteSpace(initialJson)
        || initialJson.IndexOf("\"draft\":null", StringComparison.Ordinal) >= 0
        || initialJson.IndexOf("\"draft\": null", StringComparison.Ordinal) >= 0;
    }

    static string WindowTitle(string initialJson)
    {
      if (IsPicker(initialJson))
        return "Add Operation";
      if (initialJson.IndexOf("\"type\":\"pocketing_2d\"", StringComparison.Ordinal) >= 0)
        return "2.5D Pocketing";
      if (initialJson.IndexOf("\"type\":\"profiling_2d\"", StringComparison.Ordinal) >= 0)
        return "2.5D Profiling";
      if (initialJson.IndexOf("\"type\":\"facing_2d\"", StringComparison.Ordinal) >= 0)
        return "2.5D Facing";
      if (initialJson.IndexOf("\"type\":\"parallel_finishing\"", StringComparison.Ordinal) >= 0)
        return "Parallel Finishing";
      return "OpenCAM Operation";
    }

    static string PluginDirectory()
    {
      return Path.GetDirectoryName(typeof(OpenCamOperationDialog).Assembly.Location)
        ?? throw new InvalidOperationException("Could not resolve OpenCAM plug-in directory.");
    }
  }
}
