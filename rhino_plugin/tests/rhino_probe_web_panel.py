#! python 3
"""Non-mutating inspection of OpenCAM's currently open Rhino WebView."""

import clr
import System

from System import AppDomain, Guid
from System.Net import WebClient

import Rhino
from Eto.Forms import Application, WebView
from Rhino.UI import Panels
from run_in_rhino.rhino_env.client import SocketConnection
from run_in_rhino.rhino_env.parasite import OutputParasite


def walk(control, seen):
    if control is None or id(control) in seen:
        return
    seen.add(id(control))
    yield control
    content = getattr(control, "Content", None)
    if content is not None:
        yield from walk(content, seen)
    for child in getattr(control, "Controls", []):
        yield from walk(child, seen)


connection = SocketConnection()
with OutputParasite(connection, done_msg=True):
    assemblies = [assembly.FullName for assembly in AppDomain.CurrentDomain.GetAssemblies()
                  if "opencam" in assembly.FullName.lower()]
    print("opencam_assemblies={}".format(assemblies))
    panels_type = clr.GetClrType(Panels)
    panel_type = next(assembly.GetType("RhinoCodePlatform.Rhino3D.Projects.Plugin.OpenCamWebPanel")
                      for assembly in AppDomain.CurrentDomain.GetAssemblies()
                      if assembly.GetType("RhinoCodePlatform.Rhino3D.Projects.Plugin.OpenCamWebPanel") is not None)
    panel_id = panel_type.GetProperty("PanelId").GetValue(None)
    print("opencam_panel_id={}".format(panel_id))
    print("opencam_panels_before={}".format(list(Panels.GetPanels(panel_id, Rhino.RhinoDoc.ActiveDoc))))
    Panels.OpenPanel(panel_id, True)
    opencam_panels = list(Panels.GetPanels(panel_id, Rhino.RhinoDoc.ActiveDoc))
    print("opencam_panels_after={}".format(opencam_panels))
    field_flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic
    for index, panel in enumerate(opencam_panels):
        panel_type = panel.GetType()
        view = panel_type.GetField("m_view", field_flags).GetValue(panel)
        page = panel_type.GetField("m_page", field_flags).GetValue(panel)
        url = str(view.Url)
        page_type = page.GetType()
        page_url = page_type.GetProperty("PageUrl", field_flags).GetValue(page, None)
        listener = page_type.GetField("m_listener", field_flags).GetValue(page)
        released = panel_type.GetField("m_pageReleased", field_flags).GetValue(panel)
        print("opencam_panel[{}].url={}".format(index, url))
        print("opencam_panel[{}].server_url={}".format(index, page_url))
        print("opencam_panel[{}].server_listening={} released={}".format(index, listener.IsListening, released))
        try:
            source = WebClient().DownloadString(str(page_url))
            print("opencam_panel[{}].page_bytes={}".format(index, len(source)))
            print("opencam_panel[{}].has_app={}".format(index, 'id=\"app\"' in source))
        except Exception as exception:
            print("opencam_panel[{}].request_error={}".format(index, exception))
    methods = [method for method in panels_type.GetMethods()
               if method.Name in ("GetOpenPanelIds", "GetPanel", "GetPanels", "OpenPanel")]
    print("panel_signatures={}".format(" | ".join(str(method) for method in methods)))
    print("open_panel_ids={}".format(list(Panels.GetOpenPanelIds())))
    views = []
    seen = set()
    for window in Application.Instance.Windows:
        views.extend(control for control in walk(window, seen) if isinstance(control, WebView))
    print("webviews={}".format(len(views)))
    for index, view in enumerate(views):
        url = str(view.Url)
        print("webview[{}].url={}".format(index, url))
        if not url.startswith("http://localhost:"):
            continue
        try:
            page = WebClient().DownloadString(url)
            print("webview[{}].page_bytes={}".format(index, len(page)))
            print("webview[{}].has_app={}".format(index, 'id="app"' in page))
            print("webview[{}].has_inline_script={}".format(index, "<script>" in page))
        except Exception as exception:
            print("webview[{}].request_error={}".format(index, exception))
