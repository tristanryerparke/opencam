"""Apply OpenCAM's maintained WebView/Python extension to RhinoCode output."""

import os
import shutil
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
GENERATED_ROOT = Path(os.environ.get(
    "OPENCAM_RHINO_GENERATED_ROOT", REPOSITORY_ROOT / "build" / "rh8"
))
GENERATED_PROJECT = GENERATED_ROOT / "src" / "OpenCam"
EXTENSION_SOURCE = REPOSITORY_ROOT / "src" / "OpenCamRhinoBridge"


def main():
    project_plugin = GENERATED_PROJECT / "ProjectPlugin.cs"
    source = project_plugin.read_text()
    source = source.replace("public class ProjectPlugin : PlugIn", "public partial class ProjectPlugin : PlugIn")
    if "public partial class ProjectPlugin : PlugIn" not in source:
        raise RuntimeError("Could not make generated ProjectPlugin partial.")
    project_plugin.write_text(source)

    project_file = GENERATED_PROJECT / "OpenCam.csproj"
    project_source = project_file.read_text()
    resource_item = (
        "  <ItemGroup>\n"
        "    <EmbeddedResource Include=\"Plugin.Data.resources\" LogicalName=\"Plugin.Data.resources\" />\n"
        "  </ItemGroup>\n"
    )
    if "Plugin.Data.resources" not in project_source:
        project_file.write_text(project_source.replace("</Project>", resource_item + "</Project>"))

    # RhinoCode needs one code entry to generate a plug-in project, but OpenCAM
    # exposes its native OpenCam command instead. Remove RhinoCode's generated
    # script-command wrappers before compiling the final assembly.
    for command_source in GENERATED_PROJECT.glob("ProjectCommand_*.cs"):
        command_source.unlink()

    for extension in EXTENSION_SOURCE.glob("*.cs"):
        shutil.copy2(extension, GENERATED_PROJECT / extension.name)


if __name__ == "__main__":
    main()
