using System;
using System.IO;
using System.Text;

using Eto.Forms;

using Rhino;
using Rhino.UI;

namespace RhinoCodePlatform.Rhino3D.Projects.Plugin
{
  [System.Runtime.InteropServices.Guid(PluginIds.OpenCamPanel)]
  public sealed class OpenCamWebPanel : Panel, IPanel
  {
    readonly uint m_documentSerialNumber;
    readonly WebView m_view = new WebView();
    readonly LocalPageServer m_page;
    bool m_pageLoaded;
    bool m_pageReleased;

    public OpenCamWebPanel(uint documentSerialNumber)
    {
      m_documentSerialNumber = documentSerialNumber;
      Title = "OpenCAM";
      Content = m_view;
      m_view.BrowserContextMenuEnabled = false;
      Padding = 0;
      m_page = new LocalPageServer(
        Path.Combine(PluginDirectory(), "web", "dist", "index.html"));
      m_view.MessageReceived += OnMessageReceived;
      m_view.DocumentLoading += OnDocumentLoading;
      m_view.DocumentLoaded += OnDocumentLoaded;
      m_view.Url = m_page.PageUrl;
    }

    public static Guid PanelId => typeof(OpenCamWebPanel).GUID;
    public string Title { get; private set; }

    internal void ReloadPage()
    {
      if (m_pageReleased)
        return;
      m_pageLoaded = false;
      m_view.Url = m_page.ReloadUrl();
    }

    public void PanelShown(uint documentSerialNumber, ShowPanelReason reason)
    {
      ApplyTheme();
    }
    public void PanelHidden(uint documentSerialNumber, ShowPanelReason reason) { }
    public void PanelClosing(uint documentSerialNumber, bool onCloseDocument)
    {
      ReleasePage();
    }

    protected override void OnLoad(EventArgs eventArgs)
    {
      base.OnLoad(eventArgs);
      ThemeSettings.ThemeChanged += OnThemeChanged;
      ApplyTheme();
    }

    protected override void OnUnLoad(EventArgs eventArgs)
    {
      ThemeSettings.ThemeChanged -= OnThemeChanged;
      base.OnUnLoad(eventArgs);
    }

    void OnDocumentLoading(object sender, WebViewLoadingEventArgs eventArgs)
    {
      m_pageLoaded = false;
    }

    void OnDocumentLoaded(object sender, WebViewLoadedEventArgs eventArgs)
    {
      m_pageLoaded = true;
      ApplyTheme();
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
        "window.opencamRhino && window.opencamRhino.theme(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('"
        + encoded + "'), function(c) { return c.charCodeAt(0); }))));");
    }

    void ReleasePage()
    {
      if (m_pageReleased)
        return;
      m_pageReleased = true;
      m_page.Dispose();
    }

    void OnMessageReceived(object sender, WebViewMessageEventArgs eventArgs)
    {
      // Eto WebView callbacks are UI events. Queue Python dispatch so the page
      // cannot re-enter while it is handling its outgoing postMessage.
      Application.Instance.AsyncInvoke(() =>
      {
        var response = PanelMessageBridge.Dispatch(
          m_documentSerialNumber,
          eventArgs.Message);
        Post(response);
      });
    }

    void Post(string responseJson)
    {
      var encoded = Convert.ToBase64String(
        Encoding.UTF8.GetBytes(responseJson ?? "{}"));
      _ = m_view.ExecuteScriptAsync(
        "window.opencamRhino && window.opencamRhino.receive(new TextDecoder().decode(Uint8Array.from(atob('"
        + encoded + "'), function(c) { return c.charCodeAt(0); })));");
    }

    static string PluginDirectory()
    {
      return Path.GetDirectoryName(typeof(OpenCamWebPanel).Assembly.Location)
        ?? throw new InvalidOperationException("Could not resolve OpenCAM plug-in directory.");
    }
  }
}
