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
    private readonly TextBox _setupNameInput;
    private readonly NumericStepper _xInput = new() { Value = 0, Width = 60, Increment = 1, DecimalPlaces = 2, MaximumDecimalPlaces = 2 };
    private readonly NumericStepper _yInput = new() { Value = 0, Width = 60, Increment = 1, DecimalPlaces = 2, MaximumDecimalPlaces = 2 };
    private readonly NumericStepper _zInput = new() { Value = 0, Width = 60, Increment = 1, DecimalPlaces = 2, MaximumDecimalPlaces = 2 };

    private Point3d _setupOrigin = Point3d.Origin;

    public string SetupName => string.IsNullOrWhiteSpace(_setupNameInput.Text) ? "Setup" : _setupNameInput.Text.Trim();
    public Point3d SetupOrigin => _setupOrigin;

    public OpenCamSetupDialog(SetupOriginPreviewConduit setupOriginPreview, string defaultSetupName = "Setup 1")
    {
        _setupOriginPreview = setupOriginPreview;
        _setupNameInput = new TextBox { Text = defaultSetupName };
        Title = "OpenCAM Setup";
        ClientSize = new Size(520, 170);
        Resizable = false;

        var cancelButton = new Button { Text = "Cancel" };

        cancelButton.Click += (_, _) => Close(false);
        _okButton.Click += (_, _) => Close(true);
        _selectOriginButton.Click += (_, _) => SelectSetupOrigin();

        _xInput.ValueChanged += (_, _) => ValidateInputs();
        _yInput.ValueChanged += (_, _) => ValidateInputs();
        _zInput.ValueChanged += (_, _) => ValidateInputs();

        var xGroup = new StackLayout
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalContentAlignment = VerticalAlignment.Center,
            Items = { new Label { Text = "X", VerticalAlignment = VerticalAlignment.Center }, _xInput },
        };
        var yGroup = new StackLayout
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalContentAlignment = VerticalAlignment.Center,
            Items = { new Label { Text = "Y", VerticalAlignment = VerticalAlignment.Center }, _yInput },
        };
        var zGroup = new StackLayout
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalContentAlignment = VerticalAlignment.Center,
            Items = { new Label { Text = "Z", VerticalAlignment = VerticalAlignment.Center }, _zInput },
        };

        var setupNameRow = new TableLayout
        {
            Rows =
            {
                new TableRow(
                    new TableCell(_setupNameInput, true)),
            },
        };

        var setupOriginRow = new TableLayout
        {
            Spacing = new Size(8, 8),
            Rows =
            {
                new TableRow(
                    new TableCell(xGroup, false),
                    new TableCell(yGroup, false),
                    new TableCell(zGroup, false),
                    new TableCell(new Panel(), true),
                    new TableCell(_selectOriginButton, false)),
            },
        };

        var content = new DynamicLayout
        {
            Padding = new Padding(12),
            DefaultSpacing = new Size(8, 8),
            BackgroundColor = SystemColors.ControlBackground,
        };
        content.Add(new GroupBox
        {
            Text = "Name",
            Content = setupNameRow,
        });
        content.Add(new GroupBox
        {
            Text = "Origin",
            Content = setupOriginRow,
        });
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
