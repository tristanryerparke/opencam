#! python 3
"""RhinoCode build anchor.

OpenCAM's public command is native `OpenCam`; C# owns panel registration.
RhinoCode requires one script code entry to generate its plug-in host.
"""

from Rhino import RhinoApp

RhinoApp.WriteLine("OpenCAM bridge host is loaded. Run OpenCam.")
