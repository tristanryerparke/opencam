using System;
using System.IO;
using System.Reflection;

using Eto.Forms;

using OpenCam;

using Rhino;
using Rhino.FileIO;
using Rhino.PlugIns;
using Rhino.UI;

namespace RhinoCodePlatform.Rhino3D.Projects.Plugin
{
  public partial class ProjectPlugin
  {
    const string DevelopmentRootFile = "development-python-root.txt";
    static readonly Guid RhinoCodePluginId =
      new Guid("c9cba87a-23ce-4f15-a918-97645c05cde7");
    static bool s_startupScheduled;

    public override PlugInLoadTime LoadTime => PlugInLoadTime.AtStartup;

    public static bool IsDevelopmentMode =>
      File.Exists(Path.Combine(PluginDirectory(), DevelopmentRootFile));

    public static string PythonRoot => ResolvePythonRoot();

    public static string GetDocumentDataJson(uint documentSerialNumber)
    {
      return PluginDocumentData.GetJson(documentSerialNumber);
    }

    public static bool SetDocumentDataJson(uint documentSerialNumber, string json)
    {
      return PluginDocumentData.SetJson(documentSerialNumber, json);
    }

    public static string ChooseOpenCamOperationsJson()
    {
      var dialog = new Eto.Forms.OpenFileDialog();
      dialog.Title = "Import OpenCAM operations";
      dialog.Filters.Add(new FileFilter("Rhino files", ".3dm"));
      if (dialog.ShowDialog(RhinoEtoApp.MainWindow) != DialogResult.Ok
        || string.IsNullOrWhiteSpace(dialog.FileName))
        return null;

      using (var file = File3dm.Read(dialog.FileName))
      {
        if (file == null)
          throw new InvalidOperationException("Could not read selected Rhino file.");
        foreach (var plugInData in file.PlugInData)
        {
          if (plugInData.PlugInId != Instance.Id)
            continue;
          string json = null;
          if (file.PlugInData.TryRead(plugInData, (_file, archive) =>
              {
                json = archive.ReadString();
                return true;
              }))
            return json;
        }
      }
      return "{}";
    }

    protected override LoadReturnCode OnLoad(ref string errorMessage)
    {
      Panels.RegisterPanel(this, typeof(OpenCamWebPanel), "OpenCAM", null,
        PanelType.PerDoc);
      RhinoDoc.EndOpenDocument += OnEndOpenDocument;
      RhinoDoc.NewDocument += OnNewDocument;
      RhinoDoc.CloseDocument += OnCloseDocument;
      ScheduleStartup();
      return LoadReturnCode.Success;
    }

    protected override void OnShutdown()
    {
      RhinoDoc.EndOpenDocument -= OnEndOpenDocument;
      RhinoDoc.NewDocument -= OnNewDocument;
      RhinoDoc.CloseDocument -= OnCloseDocument;
      RunPython("from opencam_rhino import startup\nstartup.shutdown()\n",
        "OpenCAM Python shutdown failed");
      base.OnShutdown();
    }

    protected override bool ShouldCallWriteDocument(FileWriteOptions options)
    {
      return true;
    }

    protected override void WriteDocument(RhinoDoc document,
      BinaryArchiveWriter archive, FileWriteOptions options)
    {
      archive.WriteString(PluginDocumentData.GetJson(document.RuntimeSerialNumber));
    }

    protected override void ReadDocument(RhinoDoc document,
      BinaryArchiveReader archive, FileReadOptions options)
    {
      PluginDocumentData.LoadJson(document, archive.ReadString());
    }

    static void ScheduleStartup()
    {
      if (s_startupScheduled)
        return;
      s_startupScheduled = true;
      Application.Instance.AsyncInvoke(() =>
      {
        s_startupScheduled = false;
        RunPython("from opencam_rhino import startup\nstartup.startup()\n",
          "OpenCAM Python startup failed");
      });
    }

    static void OnEndOpenDocument(object sender, DocumentOpenEventArgs eventArgs)
    {
      ScheduleDocumentHook("document_opened", eventArgs.Document);
    }

    static void OnNewDocument(object sender, DocumentEventArgs eventArgs)
    {
      ScheduleDocumentHook("document_opened", eventArgs.Document);
    }

    static void OnCloseDocument(object sender, DocumentEventArgs eventArgs)
    {
      var document = eventArgs.Document;
      if (document == null)
        return;
      RunDocumentHook("document_closing", document.RuntimeSerialNumber);
      PluginDocumentData.Remove(document);
    }

    static void ScheduleDocumentHook(string hook, RhinoDoc document)
    {
      if (document == null)
        return;
      var serial = document.RuntimeSerialNumber;
      Application.Instance.AsyncInvoke(() => RunDocumentHook(hook, serial));
    }

    static void RunDocumentHook(string hook, uint documentSerialNumber)
    {
      RunPython("from opencam_rhino import startup\nstartup." + hook + "("
        + documentSerialNumber + ")\n", "OpenCAM Python lifecycle failed");
    }

    internal static string RunPythonJson(string body, string resultVariable,
      string failurePrefix)
    {
      PanelResponseSink.Clear();
      var setResult = "from OpenCam import PanelResponseSink\n"
        + "PanelResponseSink.Set(str(" + resultVariable + "))\n";
      if (!RunPython(body + setResult, failurePrefix))
        return "{\"ok\":false,\"error\":\"OpenCAM Python dispatch failed.\"}";
      return PanelResponseSink.Take()
        ?? "{\"ok\":false,\"error\":\"OpenCAM Python returned no response.\"}";
    }

    static bool RunPython(string body, string failurePrefix)
    {
      try
      {
        var scripting = RhinoApp.GetPlugInObject(RhinoCodePluginId);
        var createPython = scripting?.GetType().GetMethod("CreatePython3Script",
          BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
        var python = createPython?.Invoke(scripting, null) as Rhino.Runtime.PythonScript;
        if (python == null)
          throw new InvalidOperationException("Rhino's Python 3 service could not be loaded.");
        var source = "#! python 3\nimport os\nimport sys\nimport Rhino\n"
          + "_python_root = " + PythonString(PythonRoot) + "\n"
          + "_python_site_packages = os.path.join(_python_root, 'site-packages')\n"
          + "for _python_path in (_python_root, _python_site_packages):\n"
          + "    if not os.path.isdir(_python_path):\n        continue\n"
          + "    if _python_path in sys.path:\n        sys.path.remove(_python_path)\n"
          + "    sys.path.insert(0, _python_path)\n"
          + "try:\n"
          + IndentPython(body)
          + "except Exception:\n    import traceback\n    Rhino.RhinoApp.WriteLine("
          + PythonString(failurePrefix + ":\\n")
          + " + traceback.format_exc())\n    raise\n";
        return python.ExecuteScript(source);
      }
      catch (Exception exception)
      {
        while (exception.InnerException != null)
          exception = exception.InnerException;
        RhinoApp.WriteLine(failurePrefix + ": " + exception.Message);
        return false;
      }
    }

    static string ResolvePythonRoot()
    {
      var marker = Path.Combine(PluginDirectory(), DevelopmentRootFile);
      if (File.Exists(marker))
      {
        var root = File.ReadAllText(marker).Trim();
        if (Directory.Exists(root))
          return root;
        RhinoApp.WriteLine("OpenCAM: development Python root is missing: " + root);
      }
      return Path.Combine(PluginDirectory(), "Python");
    }

    static string PluginDirectory()
    {
      return Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)
        ?? throw new InvalidOperationException("Could not resolve plug-in directory.");
    }

    static string IndentPython(string source)
    {
      return "    " + source.TrimEnd('\n').Replace("\n", "\n    ") + "\n";
    }

    static string PythonString(string value)
    {
      return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }
  }
}
