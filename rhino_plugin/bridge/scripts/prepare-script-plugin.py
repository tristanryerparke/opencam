"""Apply OpenCAM's maintained WebView/Python extension to RhinoCode output."""

import shutil
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
GENERATED_PROJECT = REPOSITORY_ROOT / "build" / "rh8" / "src" / "OpenCamRhinoBridge"
EXTENSION_SOURCE = REPOSITORY_ROOT / "src" / "OpenCamRhinoBridge"


def main():
    project_plugin = GENERATED_PROJECT / "ProjectPlugin.cs"
    source = project_plugin.read_text()
    source = source.replace("public class ProjectPlugin : PlugIn", "public partial class ProjectPlugin : PlugIn")
    if "public partial class ProjectPlugin : PlugIn" not in source:
        raise RuntimeError("Could not make generated ProjectPlugin partial.")
    project_plugin.write_text(source)

    project_file = GENERATED_PROJECT / "OpenCamRhinoBridge.csproj"
    project_source = project_file.read_text()
    resource_item = (
        "  <ItemGroup>\n"
        "    <EmbeddedResource Include=\"Plugin.Data.resources\" LogicalName=\"Plugin.Data.resources\" />\n"
        "  </ItemGroup>\n"
    )
    if "Plugin.Data.resources" not in project_source:
        project_file.write_text(project_source.replace("</Project>", resource_item + "</Project>"))

    for extension in EXTENSION_SOURCE.glob("*.cs"):
        shutil.copy2(extension, GENERATED_PROJECT / extension.name)


if __name__ == "__main__":
    main()
