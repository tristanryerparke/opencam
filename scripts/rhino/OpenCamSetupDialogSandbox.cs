using System;
using System.Globalization;
using SDColor = System.Drawing.Color;
using Eto.Forms;
using Eto.Drawing;
using Rhino;
using Rhino.UI;
using Rhino.Display;
using Rhino.Geometry;
using Rhino.Input;

/*
Open in Rhino's ScriptEditor and run with F5.

Useful docs:
- ScriptEditor: https://developer.rhino3d.com/en/guides/scripting/scripting-command/
- Eto + Rhino parenting: https://developer.rhino3d.com/en/guides/eto/rhino-specific/
- Eto containers: https://developer.rhino3d.com/en/guides/eto/containers/

Notes:
- In ScriptEditor, modal Dialogs are better for this than Forms.
- Use RhinoEtoApp.MainWindowForDocument(__rhino_doc__) for correct parenting.
- Keep the sandbox self-contained, then port the final layout back into the plugin.
*/

var conduit = new SetupOriginPreviewConduit();
var dialog = new OpenCamSetupDialogSandbox(__rhino_doc__, conduit);
var parent = RhinoEtoApp.MainWindowForDocument(__rhino_doc__);

try
{
    dialog.ShowModal(parent);
}
finally
{
    conduit.Clear();
    __rhino_doc__.Views.Redraw();
}

public sealed class OpenCamSetupDialogSandbox : Dialog<bool>
{
    private readonly RhinoDoc _doc;
    private readonly SetupOriginPreviewConduit _preview;
    private readonly Button _okButton = new() { Text = "OK" };
    private readonly Button _selectOriginButton = new() { Text = "Select Point" };
    private readonly NumericStepper _xInput = new() { Value = 0, Width = 55, Increment = 1, DecimalPlaces = 2, MaximumDecimalPlaces = 2 };
    private readonly NumericStepper _yInput = new() { Value = 0, Width = 55, Increment = 1, DecimalPlaces = 2, MaximumDecimalPlaces = 2 };
    private readonly NumericStepper _zInput = new() { Value = 0, Width = 55, Increment = 1, DecimalPlaces = 2, MaximumDecimalPlaces = 2 };

    public OpenCamSetupDialogSandbox(RhinoDoc doc, SetupOriginPreviewConduit preview)
    {
        _doc = doc;
        _preview = preview;

        Title = "OpenCAM Setup Sandbox";
        ClientSize = new Size(520, 120);
        Resizable = false;

        var cancelButton = new Button { Text = "Cancel" };
        cancelButton.Click += (_, _) => Close(false);
        _okButton.Click += (_, _) => Close(true);
        _selectOriginButton.Click += (_, _) => SelectSetupOrigin();

        _xInput.ValueChanged += (_, _) => ValidateInputs();
        _yInput.ValueChanged += (_, _) => ValidateInputs();
        _zInput.ValueChanged += (_, _) => ValidateInputs();

        var topRow = new TableLayout
        {
            Spacing = new Size(8, 8),
            Rows =
            {
                new TableRow(
                    new TableCell(new Label { Text = "Setup Origin:", VerticalAlignment = VerticalAlignment.Center }, false),
                    new TableCell(new Panel(), true),
                    new TableCell(new Label { Text = "X", VerticalAlignment = VerticalAlignment.Center }, false),
                    new TableCell(_xInput, false),
                    new TableCell(new Label { Text = "Y", VerticalAlignment = VerticalAlignment.Center }, false),
                    new TableCell(_yInput, false),
                    new TableCell(new Label { Text = "Z", VerticalAlignment = VerticalAlignment.Center }, false),
                    new TableCell(_zInput, false),
                    new TableCell(_selectOriginButton, false)),
            },
        };

        var content = new DynamicLayout
        {
            Padding = new Padding(12),
            DefaultSpacing = new Size(8, 8),
        };
        content.Add(topRow);
        content.Add(null, yscale: true);
        content.AddSeparateRow(null, cancelButton, _okButton);

        Content = content;

        DefaultButton = _okButton;
        AbortButton = cancelButton;

        ValidateInputs();
    }

    private void SelectSetupOrigin()
    {
        try
        {
            _selectOriginButton.Focus();
            Visible = false;

            var result = RhinoGet.GetPoint("Select setup origin", false, out var point);
            if (result == Rhino.Commands.Result.Success)
            {
                _xInput.Value = point.X;
                _yInput.Value = point.Y;
                _zInput.Value = point.Z;
                _preview.Show(point);
                _doc.Views.Redraw();
            }
        }
        finally
        {
            Visible = true;
            BringToFront();
        }
    }

    private void ValidateInputs()
    {
        var point = new Point3d(
            Convert.ToDouble(_xInput.Value, CultureInfo.InvariantCulture),
            Convert.ToDouble(_yInput.Value, CultureInfo.InvariantCulture),
            Convert.ToDouble(_zInput.Value, CultureInfo.InvariantCulture));

        _okButton.Enabled = point.IsValid;
        if (!point.IsValid)
        {
            return;
        }

        _preview.Show(point);
        _doc.Views.Redraw();
    }
}

public sealed class SetupOriginPreviewConduit : DisplayConduit
{
    private const double AxisLength = 25.0;
    private const double ArrowLengthFactor = 0.2;
    private const double ArrowWidthFactor = 0.08;

    public Point3d? Origin { get; private set; }

    public void Show(Point3d origin)
    {
        Origin = origin;
        Enabled = true;
    }

    public void Clear()
    {
        Origin = null;
        Enabled = false;
    }

    protected override void PostDrawObjects(DrawEventArgs e)
    {
        if (Origin is not Point3d origin)
        {
            return;
        }

        DrawAxis(e, origin, Vector3d.XAxis, SDColor.Red);
        DrawAxis(e, origin, Vector3d.YAxis, SDColor.LimeGreen);
        DrawAxis(e, origin, Vector3d.ZAxis, SDColor.FromArgb(0, 0, 255));
    }

    protected override void CalculateBoundingBox(CalculateBoundingBoxEventArgs e)
    {
        if (Origin is not Point3d origin)
        {
            return;
        }

        e.IncludeBoundingBox(new BoundingBox(new[]
        {
            origin,
            origin + (Vector3d.XAxis * AxisLength),
            origin + (Vector3d.YAxis * AxisLength),
            origin + (Vector3d.ZAxis * AxisLength),
        }));
    }

    private static void DrawAxis(DrawEventArgs e, Point3d origin, Vector3d axis, SDColor color)
    {
        var direction = axis;
        direction.Unitize();

        var end = origin + (direction * AxisLength);
        e.Display.DrawLine(origin, end, color, 2);
        DrawArrowHead(e, end, direction, color);
    }

    private static void DrawArrowHead(DrawEventArgs e, Point3d tip, Vector3d direction, SDColor color)
    {
        var arrowLength = AxisLength * ArrowLengthFactor;
        var arrowWidth = AxisLength * ArrowWidthFactor;
        var baseCenter = tip - (direction * arrowLength);

        var up = Math.Abs(direction.Z) < 0.9 ? Vector3d.ZAxis : Vector3d.XAxis;
        var perpendicular = Vector3d.CrossProduct(direction, up);
        if (!perpendicular.Unitize())
        {
            return;
        }

        var sideA = baseCenter + (perpendicular * arrowWidth);
        var sideB = baseCenter - (perpendicular * arrowWidth);

        e.Display.DrawLine(sideA, tip, color, 2);
        e.Display.DrawLine(sideB, tip, color, 2);
    }
}
