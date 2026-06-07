using System;
using Rhino.PlugIns;
using Rhino.UI;
using OpenCamRhinoPlugin.Panels;

namespace OpenCamRhinoPlugin;

[System.Runtime.InteropServices.Guid("2eb0a4c1-6dff-4c50-b693-cf8ea4c885e3")]
public sealed class OpenCamRhinoPlugin : PlugIn
{
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
}
