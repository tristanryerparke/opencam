using Eto.Drawing;
using Eto.Forms;
using Rhino;
using Rhino.UI;
using OpenCamRhinoPlugin.Display;

namespace OpenCamRhinoPlugin.Panels;

[System.Runtime.InteropServices.Guid("8001aab4-2835-43b4-8584-9c54dd72afc6")]
public sealed class OpenCamPanel : Eto.Forms.Panel, IPanel
{
    private readonly uint _documentSerialNumber;
    private readonly Button _setupButton = new() { Text = "＋ Setup" };
    private readonly Button _operationButton = new() { Text = "＋ Operation" };
    private readonly Drawable _backendDot = new() { Size = new Size(12, 12), ToolTip = "Backend disconnected" };
    private readonly UITimer _backendIndicatorTimer = new() { Interval = 5.0 };
    private readonly SetupOriginPreviewConduit _setupOriginPreview = new();

    private bool _backendConnected;

    public OpenCamPanel(uint documentSerialNumber)
    {
        _documentSerialNumber = documentSerialNumber;
        Content = BuildContent();

        _setupButton.Click += (_, _) => ShowSetupModal();
        _operationButton.Click += (_, _) => RhinoApp.WriteLine("[OpenCAM:UI] Operation clicked");
        _backendDot.Paint += PaintBackendDot;
        _backendIndicatorTimer.Elapsed += (_, _) => ToggleBackendIndicator();
        _backendIndicatorTimer.Start();

        LogUi("Panel created", new { documentSerialNumber = _documentSerialNumber });
    }

    public static Guid PanelId => typeof(OpenCamPanel).GUID;

    public void PanelShown(uint documentSerialNumber, ShowPanelReason reason)
    {
        LogUi("Panel shown", new { documentSerialNumber, reason = reason.ToString() });
    }

    public void PanelHidden(uint documentSerialNumber, ShowPanelReason reason)
    {
    }

    public void PanelClosing(uint documentSerialNumber, bool onCloseDocument)
    {
        _backendIndicatorTimer.Stop();
        _setupOriginPreview.Clear();
        LogUi("Panel closing", new { documentSerialNumber, onCloseDocument });
    }

    private Control BuildContent()
    {
        var root = new DynamicLayout
        {
            Padding = new Padding(1),
            DefaultSpacing = new Size(1, 1),
            BackgroundColor = SystemColors.ControlBackground,
        };

        var toolbar = new DynamicLayout
        {
            Padding = new Padding(4),
            DefaultSpacing = new Size(4, 4),
        };
        toolbar.AddRow(_setupButton, _operationButton, null, _backendDot);

        var body = new Eto.Forms.Panel
        {
            BackgroundColor = SystemColors.ControlBackground,
        };

        root.Add(toolbar);
        root.Add(new Eto.Forms.Panel
        {
            Height = 1,
            BackgroundColor = SystemColors.DisabledText,
        });
        root.Add(body, yscale: true);
        return root;
    }

    private void ShowSetupModal()
    {
        var dialog = new OpenCamSetupDialog(_setupOriginPreview);
        dialog.ShowModal(RhinoEtoApp.MainWindow);
    }

    private void ToggleBackendIndicator()
    {
        _backendConnected = !_backendConnected;
        _backendDot.ToolTip = _backendConnected ? "Backend connected" : "Backend disconnected";
        _backendDot.Invalidate();
    }

    private void PaintBackendDot(object? sender, PaintEventArgs e)
    {
        var color = _backendConnected ? Colors.LimeGreen : Colors.Red;
        var diameter = Math.Min(_backendDot.Width, _backendDot.Height) - 2;
        var x = (_backendDot.Width - diameter) / 2f;
        var y = (_backendDot.Height - diameter) / 2f;

        e.Graphics.AntiAlias = true;
        e.Graphics.FillEllipse(new SolidBrush(color), x, y, diameter, diameter);
    }

    private static void LogUi(string message, object? data = null)
    {
        var suffix = data == null ? string.Empty : " :: " + System.Text.Json.JsonSerializer.Serialize(data);
        RhinoApp.WriteLine($"[OpenCAM:UI] {message}{suffix}");
    }
}
