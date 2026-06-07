using System;
using Rhino;
using Rhino.Commands;
using Rhino.UI;
using OpenCamRhinoPlugin.Panels;

namespace OpenCamRhinoPlugin.Commands;

[System.Runtime.InteropServices.Guid("18dd84f9-4dd7-4e06-a117-058d7966e5cc")]
public sealed class OpenCamCommand : Command
{
    public override string EnglishName => "OpenCam";

    protected override Result RunCommand(RhinoDoc doc, RunMode mode)
    {
        Rhino.UI.Panels.OpenPanel(OpenCamPanel.PanelId);
        return Result.Success;
    }
}
