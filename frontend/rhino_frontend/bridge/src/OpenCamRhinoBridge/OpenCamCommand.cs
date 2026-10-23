using System.Runtime.InteropServices;

using Rhino;
using Rhino.Commands;
using Rhino.UI;

namespace RhinoCodePlatform.Rhino3D.Projects.Plugin
{
  [Guid(PluginIds.OpenCamCommand)]
  public sealed class OpenCamCommand : Command
  {
    public override string EnglishName => "OpenCam";

    protected override Result RunCommand(RhinoDoc doc, RunMode mode)
    {
      Panels.OpenPanel(OpenCamWebPanel.PanelId);
      return Result.Success;
    }
  }
}
