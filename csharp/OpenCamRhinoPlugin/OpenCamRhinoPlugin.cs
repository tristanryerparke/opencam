using Rhino;
using Rhino.Collections;
using Rhino.FileIO;
using Rhino.PlugIns;
using Rhino.UI;
using OpenCamRhinoPlugin.Models;
using OpenCamRhinoPlugin.Panels;

namespace OpenCamRhinoPlugin;

[System.Runtime.InteropServices.Guid("2eb0a4c1-6dff-4c50-b693-cf8ea4c885e3")]
public sealed class OpenCamRhinoPlugin : PlugIn
{
    private const string ArchiveKeySetupCount = "SetupCount";
    private const string ArchiveKeyId = "Id";
    private const string ArchiveKeyName = "Name";
    private const string ArchiveKeyOrigin = "Origin";
    private const string ArchiveKeyOperationCount = "OperationCount";
    private const string ArchiveKeySetupPrefix = "Setup:";
    private const string ArchiveKeyOperationPrefix = "Operation:";

    private readonly Dictionary<uint, List<OpenCamSetupState>> _documentSetups = new();

    public OpenCamRhinoPlugin()
    {
        Instance = this;
    }

    public static OpenCamRhinoPlugin? Instance { get; private set; }

    protected override LoadReturnCode OnLoad(ref string errorMessage)
    {
        Rhino.UI.Panels.RegisterPanel(
            this,
            typeof(OpenCamPanel),
            "OpenCAM",
            null,
            PanelType.PerDoc);

        return LoadReturnCode.Success;
    }

    protected override bool ShouldCallWriteDocument(FileWriteOptions options)
    {
        return true;
    }

    protected override void WriteDocument(RhinoDoc doc, BinaryArchiveWriter archive, FileWriteOptions options)
    {
        var setups = GetOrCreateSetups(doc);
        RhinoApp.WriteLine($"[OpenCAM] WriteDocument doc={doc.RuntimeSerialNumber} setups={setups.Count}");
        var root = new ArchivableDictionary(1, "OpenCamRhinoPluginDocumentData");
        root.Set(ArchiveKeySetupCount, setups.Count);

        for (var setupIndex = 0; setupIndex < setups.Count; setupIndex += 1)
        {
            var setup = setups[setupIndex];
            var setupDictionary = new ArchivableDictionary(1, "OpenCamSetupState");
            setupDictionary.Set(ArchiveKeyId, setup.Id);
            setupDictionary.Set(ArchiveKeyName, setup.Name);
            setupDictionary.Set(ArchiveKeyOrigin, setup.Origin);
            setupDictionary.Set(ArchiveKeyOperationCount, setup.Operations.Count);

            for (var operationIndex = 0; operationIndex < setup.Operations.Count; operationIndex += 1)
            {
                var operation = setup.Operations[operationIndex];
                var operationDictionary = new ArchivableDictionary(1, "OpenCamOperationState");
                operationDictionary.Set(ArchiveKeyName, operation.Name);
                setupDictionary.Set(ArchiveKeyOperationPrefix + operationIndex, operationDictionary);
            }

            root.Set(ArchiveKeySetupPrefix + setupIndex, setupDictionary);
        }

        archive.WriteDictionary(root);
    }

    protected override void ReadDocument(RhinoDoc doc, BinaryArchiveReader archive, FileReadOptions options)
    {
        RhinoApp.WriteLine($"[OpenCAM] ReadDocument doc={doc.RuntimeSerialNumber}");
        var root = archive.ReadDictionary();
        var setups = new List<OpenCamSetupState>();
        var setupCount = root.GetInteger(ArchiveKeySetupCount, 0);

        for (var setupIndex = 0; setupIndex < setupCount; setupIndex += 1)
        {
            var setupDictionary = root.GetDictionary(ArchiveKeySetupPrefix + setupIndex);
            if (setupDictionary == null)
            {
                continue;
            }

            var setup = new OpenCamSetupState
            {
                Id = setupDictionary.GetGuid(ArchiveKeyId, Guid.NewGuid()),
                Name = setupDictionary.GetString(ArchiveKeyName, "Setup"),
                Origin = setupDictionary.GetPoint3d(ArchiveKeyOrigin, Rhino.Geometry.Point3d.Origin),
            };

            var operationCount = setupDictionary.GetInteger(ArchiveKeyOperationCount, 0);
            for (var operationIndex = 0; operationIndex < operationCount; operationIndex += 1)
            {
                var operationDictionary = setupDictionary.GetDictionary(ArchiveKeyOperationPrefix + operationIndex);
                if (operationDictionary == null)
                {
                    continue;
                }

                setup.Operations.Add(new OpenCamOperationState
                {
                    Name = operationDictionary.GetString(ArchiveKeyName, "Operation"),
                });
            }

            if (setup.Operations.Count == 0)
            {
                setup.Operations.Add(new OpenCamOperationState());
            }

            setups.Add(setup);
        }

        _documentSetups[doc.RuntimeSerialNumber] = setups;
        RhinoApp.WriteLine($"[OpenCAM] ReadDocument loaded setups={setups.Count}");
    }

    internal List<OpenCamSetupState> GetOrCreateSetups(RhinoDoc doc)
    {
        if (!_documentSetups.TryGetValue(doc.RuntimeSerialNumber, out var setups))
        {
            setups = new List<OpenCamSetupState>();
            _documentSetups[doc.RuntimeSerialNumber] = setups;
        }

        return setups;
    }
}
