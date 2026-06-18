using Eto.Drawing;
using Eto.Forms;
using Rhino;
using Rhino.Geometry;
using Rhino.UI;
using OpenCamRhinoPlugin.Display;
using OpenCamRhinoPlugin.Models;

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
    private readonly TreeGridView _setupTree = new() { ShowHeader = false };
    private readonly TreeGridItemCollection _setupTreeData = new();
    private readonly ContextMenu _setupContextMenu = new();

    private bool _backendConnected;
    private int _setupCount;
    private Guid? _contextSetupId;
    private List<OpenCamSetupState> _setups = new();

    public OpenCamPanel(uint documentSerialNumber)
    {
        _documentSerialNumber = documentSerialNumber;
        _setups = OpenCamRhinoPlugin.Instance?.GetOrCreateSetups(GetDocument() ?? RhinoDoc.ActiveDoc!) ?? new List<OpenCamSetupState>();
        _setupCount = _setups.Count;
        Content = BuildContent();

        _setupButton.Click += (_, _) => ShowSetupModal();
        _operationButton.Click += (_, _) => RhinoApp.WriteLine("[OpenCAM:UI] Operation clicked");
        _backendDot.Paint += PaintBackendDot;
        _backendIndicatorTimer.Elapsed += (_, _) => ToggleBackendIndicator();
        _backendIndicatorTimer.Start();

        ConfigureSetupContextMenu();
        RefreshSetupTree();

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

        _setupTree.Columns.Add(new GridColumn
        {
            DataCell = new TextBoxCell(0),
            Editable = false,
            AutoSize = true,
        });
        _setupTree.DataStore = _setupTreeData;
        _setupTree.CellClick += OnSetupTreeCellClick;
        _setupTree.SelectedItemChanged += (_, _) => UpdateSetupOriginPreviewFromSelection();

        var body = new Eto.Forms.Panel
        {
            BackgroundColor = SystemColors.ControlBackground,
            Content = _setupTree,
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

    private void ConfigureSetupContextMenu()
    {
        var addOperationItem = new ButtonMenuItem { Text = "Add Operation" };
        addOperationItem.Click += (_, _) => AddOperationToContextSetup();

        var renameItem = new ButtonMenuItem { Text = "Rename" };
        renameItem.Click += (_, _) => RenameContextSetup();

        var deleteItem = new ButtonMenuItem { Text = "Delete" };
        deleteItem.Click += (_, _) => DeleteContextSetup();

        var duplicateItem = new ButtonMenuItem { Text = "Duplicate" };
        duplicateItem.Click += (_, _) => DuplicateContextSetup();

        var postProcessItem = new ButtonMenuItem { Text = "Post Process" };
        postProcessItem.Click += (_, _) => PostProcessContextSetup();

        _setupContextMenu.Items.Add(addOperationItem);
        _setupContextMenu.Items.Add(renameItem);
        _setupContextMenu.Items.Add(deleteItem);
        _setupContextMenu.Items.Add(duplicateItem);
        _setupContextMenu.Items.Add(postProcessItem);
    }

    private void ShowSetupModal()
    {
        var dialog = new OpenCamSetupDialog(_setupOriginPreview, $"Setup {_setupCount + 1}");
        if (dialog.ShowModal(GetParentWindow()) != true)
        {
            UpdateSetupOriginPreviewFromSelection();
            return;
        }

        _setupCount += 1;
        var setup = new OpenCamSetupState
        {
            Name = dialog.SetupName,
            Origin = dialog.SetupOrigin,
            Operations = new List<OpenCamOperationState>
            {
                new() { Name = "Operation" },
            },
        };

        _setups.Add(setup);
        MarkDocumentModified();
        RefreshSetupTree(setup.Id);
    }

    private void OnSetupTreeCellClick(object? sender, GridCellMouseEventArgs e)
    {
        if (e.Buttons != MouseButtons.Alternate || e.Item is not SetupTreeNode node)
        {
            return;
        }

        _contextSetupId = node.SetupId;
        _setupTree.SelectedItem = node;
        _setupContextMenu.Show(_setupTree, e.Location);
    }

    private void AddOperationToContextSetup()
    {
        var setup = GetContextSetup();
        if (setup == null)
        {
            return;
        }

        setup.Operations.Add(new OpenCamOperationState { Name = "Operation" });
        MarkDocumentModified();
        RefreshSetupTree(setup.Id);
    }

    private void RenameContextSetup()
    {
        var setup = GetContextSetup();
        if (setup == null)
        {
            return;
        }

        var renamed = PromptForSetupName("Rename Setup", setup.Name);
        if (string.IsNullOrWhiteSpace(renamed))
        {
            return;
        }

        setup.Name = renamed.Trim();
        MarkDocumentModified();
        RefreshSetupTree(setup.Id);
    }

    private void DeleteContextSetup()
    {
        var setup = GetContextSetup();
        if (setup == null)
        {
            return;
        }

        var result = MessageBox.Show(
            this,
            $"Delete '{setup.Name}'?",
            "Delete Setup",
            MessageBoxButtons.YesNo,
            MessageBoxType.Warning,
            MessageBoxDefaultButton.No);
        if (result != DialogResult.Yes)
        {
            return;
        }

        _setups.Remove(setup);
        MarkDocumentModified();
        RefreshSetupTree();
    }

    private void DuplicateContextSetup()
    {
        var setup = GetContextSetup();
        if (setup == null)
        {
            return;
        }

        _setupCount += 1;
        var duplicate = new OpenCamSetupState
        {
            Name = setup.Name + " Copy",
            Origin = setup.Origin,
            Operations = setup.Operations.Select(operation => new OpenCamOperationState { Name = operation.Name }).ToList(),
        };

        _setups.Add(duplicate);
        MarkDocumentModified();
        RefreshSetupTree(duplicate.Id);
    }

    private void PostProcessContextSetup()
    {
        var setup = GetContextSetup();
        if (setup == null)
        {
            return;
        }

        MessageBox.Show(this, $"Post Process placeholder for '{setup.Name}'.", "OpenCAM", MessageBoxType.Information);
    }

    private OpenCamSetupState? GetContextSetup()
    {
        return _contextSetupId == null
            ? null
            : _setups.FirstOrDefault(setup => setup.Id == _contextSetupId.Value);
    }

    private string? PromptForSetupName(string title, string currentName)
    {
        var input = new TextBox { Text = currentName };
        var okButton = new Button { Text = "OK" };
        var cancelButton = new Button { Text = "Cancel" };

        var dialog = new Dialog<bool>
        {
            Title = title,
            ClientSize = new Size(360, 100),
            Resizable = false,
        };

        okButton.Click += (_, _) => dialog.Close(true);
        cancelButton.Click += (_, _) => dialog.Close(false);
        input.TextChanged += (_, _) => okButton.Enabled = !string.IsNullOrWhiteSpace(input.Text);

        var layout = new DynamicLayout
        {
            Padding = new Padding(12),
            DefaultSpacing = new Size(8, 8),
        };
        layout.Add(input);
        layout.Add(null, yscale: true);
        layout.AddSeparateRow(null, cancelButton, okButton);

        dialog.Content = layout;
        dialog.DefaultButton = okButton;
        dialog.AbortButton = cancelButton;
        okButton.Enabled = !string.IsNullOrWhiteSpace(input.Text);

        return dialog.ShowModal(GetParentWindow()) == true
            ? input.Text?.Trim()
            : null;
    }

    private void RefreshSetupTree(Guid? selectedSetupId = null)
    {
        _setupTreeData.Clear();
        SetupTreeNode? selectedNode = null;

        foreach (var setup in _setups)
        {
            var setupNode = new SetupTreeNode(setup.Id, SetupNodeKind.Setup, setup.Name)
            {
                Expanded = false,
            };

            foreach (var operation in setup.Operations)
            {
                setupNode.Children.Add(new SetupTreeNode(setup.Id, SetupNodeKind.Operation, operation.Name));
            }

            _setupTreeData.Add(setupNode);
            if (selectedSetupId == setup.Id)
            {
                selectedNode = setupNode;
            }
        }

        _setupTree.DataStore = null;
        _setupTree.DataStore = _setupTreeData;
        if (selectedNode != null)
        {
            _setupTree.SelectedItem = selectedNode;
        }
        else
        {
            UpdateSetupOriginPreview(null);
        }
    }

    private void UpdateSetupOriginPreviewFromSelection()
    {
        if (_setupTree.SelectedItem is not SetupTreeNode node)
        {
            UpdateSetupOriginPreview(null);
            return;
        }

        var setup = _setups.FirstOrDefault(candidate => candidate.Id == node.SetupId);
        UpdateSetupOriginPreview(setup);
    }

    private void UpdateSetupOriginPreview(OpenCamSetupState? setup)
    {
        if (setup != null)
        {
            _setupOriginPreview.Show(setup.Origin, setup.Name);
        }
        else
        {
            _setupOriginPreview.Clear();
        }

        GetDocument()?.Views.Redraw();
    }

    private RhinoDoc? GetDocument()
    {
        return RhinoDoc.FromRuntimeSerialNumber(_documentSerialNumber);
    }

    private Window GetParentWindow()
    {
        return GetDocument() is { } document
            ? RhinoEtoApp.MainWindowForDocument(document)
            : RhinoEtoApp.MainWindow;
    }

    private void MarkDocumentModified()
    {
        var document = GetDocument();
        if (document == null)
        {
            return;
        }

        document.Modified = true;
        RhinoApp.WriteLine($"[OpenCAM] Marked document modified doc={document.RuntimeSerialNumber}");
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

    private enum SetupNodeKind
    {
        Setup,
        Operation,
    }

    private sealed class SetupTreeNode : TreeGridItem
    {
        public SetupTreeNode(Guid setupId, SetupNodeKind kind, string text)
            : base(new object[] { text })
        {
            SetupId = setupId;
            Kind = kind;
        }

        public Guid SetupId { get; }
        public SetupNodeKind Kind { get; }
    }
}
