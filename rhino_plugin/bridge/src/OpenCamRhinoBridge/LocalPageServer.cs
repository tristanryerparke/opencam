using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading.Tasks;

namespace RhinoCodePlatform.Rhino3D.Projects.Plugin
{
  /// <summary>Serves one bundled page from localhost, avoiding WebView file-origin restrictions.</summary>
  internal sealed class LocalPageServer : IDisposable
  {
    readonly HttpListener m_listener = new HttpListener();
    readonly string m_pagePath;

    internal LocalPageServer(string pagePath)
    {
      if (!File.Exists(pagePath))
        throw new FileNotFoundException("OpenCAM panel page is missing.", pagePath);
      m_pagePath = pagePath;
      var tcp = new TcpListener(IPAddress.Loopback, 0);
      tcp.Start();
      var port = ((IPEndPoint)tcp.LocalEndpoint).Port;
      tcp.Stop();
      m_listener.Prefixes.Add("http://localhost:" + port + "/");
      m_listener.Start();
      PageUrl = new Uri("http://localhost:" + port + "/");
      _ = ServeAsync();
    }

    internal Uri PageUrl { get; private set; }

    internal Uri ReloadUrl()
    {
      return new Uri(PageUrl.AbsoluteUri + "?reload=" + Guid.NewGuid().ToString("N"));
    }

    public void Dispose()
    {
      m_listener.Close();
    }

    async Task ServeAsync()
    {
      while (m_listener.IsListening)
      {
        HttpListenerContext context;
        try
        {
          context = await m_listener.GetContextAsync().ConfigureAwait(false);
        }
        catch (Exception exception) when (exception is HttpListenerException
          || exception is ObjectDisposedException
          || exception is InvalidOperationException)
        {
          return;
        }
        try
        {
          if (context.Request.Url == null || context.Request.Url.AbsolutePath != "/")
          {
            context.Response.StatusCode = (int)HttpStatusCode.NotFound;
          }
          else
          {
            var page = File.ReadAllBytes(m_pagePath);
            context.Response.ContentType = "text/html; charset=utf-8";
            context.Response.ContentLength64 = page.Length;
            await context.Response.OutputStream.WriteAsync(
              page, 0, page.Length).ConfigureAwait(false);
          }
        }
        catch (Exception exception) when (exception is HttpListenerException
          || exception is IOException
          || exception is ObjectDisposedException
          || exception is UnauthorizedAccessException)
        {
          // Panel close or WebView navigation can close a response mid-write.
        }
        finally
        {
          context.Response.Close();
        }
      }
    }
  }
}
