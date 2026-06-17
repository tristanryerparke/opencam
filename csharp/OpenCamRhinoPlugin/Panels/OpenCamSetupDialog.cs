using System.Globalization;
using Eto.Drawing;
using Eto.Forms;
using Rhino;
using Rhino.Geometry;
using Rhino.Input;
using OpenCamRhinoPlugin.Display;

namespace OpenCamRhinoPlugin.Panels;

public sealed class OpenCamSetupDialog : Dialog<bool>
{
    private readonly SetupOriginPreviewConduit _setupOriginPreview;
    private readonly Button _okButton = new() { Text = "OK" };
    private readonly Button _selectOriginButton = new() { Text = "Select Point" };
    private readonly NumericStepper _xInput = new() { Value = 0, Width = 55, Increment = 1, DecimalPlaces = 2, MaximumDecimalPlaces = 2 };
    private readonly NumericStepper _yInput = new() { Value = 0, Width = 55, Increment = 1, DecimalPlaces = 2, MaximumDecimalPlaces = 2 };
    private readonly NumericStepper _zInput = new() { Value = 0, Width = 55, Increment = 1, DecimalPlaces = 2, MaximumDecimalPlaces = 2 };

    private Point3d _setupOrigin = Point3d.Origin;

    public OpenCamSetupDialog(SetupOriginPreviewConduit setupOriginPreview)
    {
        _setupOriginPreview = setupOriginPreview;
        Title = "OpenCAM Setup";
        ClientSize = new Size(520, 120);
        Resizable = false;

        var cancelButton = new Button { Text = "Cancel" };

        cancelButton.Click += (_, _) => Close(false);
        _okButton.Click += (_, _) => Close(true);
        _selectOriginButton.Click += (_, _) => SelectSetupOrigin();

        _xInput.ValueChanged += (_, _) => ValidateInputs();
        _yInput.ValueChanged += (_, _) => ValidateInputs();
        _zInput.ValueChanged += (_, _) => ValidateInputs();

        var originInputsRow = new StackLayout
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalContentAlignment = VerticalAlignment.Center,
            Items =
            {
                new Label { Text = "X", VerticalAlignment = VerticalAlignment.Center },
                _xInput,
                new Label { Text = "Y", VerticalAlignment = VerticalAlignment.Center },
                _yInput,
                new Label { Text = "Z", VerticalAlignment = VerticalAlignment.Center },
                _zInput,
                _selectOriginButton,
            },
        };

        var layout = new TableLayout
        {
            Padding = new Padding(12),
            Spacing = new Size(8, 8),
            BackgroundColor = SystemColors.ControlBackground,
            Rows =
            {
                new TableRow(
                    new TableCell(new Label { Text = "Setup Origin:", VerticalAlignment = VerticalAlignment.Center }, scaleWidth: false),
                    new TableCell(new Panel(), scaleWidth: true),
                    new TableCell(originInputsRow, scaleWidth: false)),
                new TableRow(
                    new TableCell(new Panel(), scaleWidth: false),
                    new TableCell(new Panel(), scaleWidth: true),
                    new TableCell(new Panel(), scaleWidth: false))
                {
                    ScaleHeight = true,
                },
                new TableRow(
                    new TableCell(new Panel(), scaleWidth: false),
                    new TableCell(cancelButton, scaleWidth: false),
                    new TableCell(_okButton, scaleWidth: false)),
            },
        };

        Content = layout;
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
                _setupOrigin = point;
                _xInput.Value = point.X;
                _yInput.Value = point.Y;
                _zInput.Value = point.Z;
                _setupOriginPreview.Show(point);
                RhinoDoc.ActiveDoc?.Views.Redraw();
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
        if (!TryReadPoint(out var point))
        {
            _okButton.Enabled = false;
            return;
        }

        _okButton.Enabled = true;
        _setupOrigin = point;
        _setupOriginPreview.Show(point);
        RhinoDoc.ActiveDoc?.Views.Redraw();
    }

    private bool TryReadPoint(out Point3d point)
    {
        point = Point3d.Origin;

        var x = Convert.ToDouble(_xInput.Value, CultureInfo.InvariantCulture);
        var y = Convert.ToDouble(_yInput.Value, CultureInfo.InvariantCulture);
        var z = Convert.ToDouble(_zInput.Value, CultureInfo.InvariantCulture);

        return CreatePoint(x, y, z, out point);
    }

    private static bool CreatePoint(double x, double y, double z, out Point3d point)
    {
        point = new Point3d(x, y, z);
        return point.IsValid;
    }

}
