using System;
using Rhino.PlugIns;
using Rhino.UI;
using OpenCamRhinoPlugin.Panels;

namespace OpenCamRhinoPlugin;

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
