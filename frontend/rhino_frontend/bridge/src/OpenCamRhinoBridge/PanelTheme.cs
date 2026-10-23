using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

using Eto.Drawing;

using Rhino;
using Rhino.ApplicationSettings;
using Rhino.UI;

namespace RhinoCodePlatform.Rhino3D.Projects.Plugin
{
  /// <summary>Rhino chrome palette translated into panel CSS variables.</summary>
  internal static class PanelTheme
  {
    internal static string Json()
    {
      var chrome = Paint(PaintColor.PanelBackground);
      var field = Read(ThemeSettings.Content.List.Enabled.Background);
      var text = Paint(PaintColor.TextEnabled);
      var dim = Paint(PaintColor.TextDisabled);
      var border = Paint(PaintColor.GridLinesOnPanelBackground);
      var accent = Read(SystemColors.Highlight);
      var accentText = Read(SystemColors.HighlightText);
      var selection = Read(SystemColors.Selection);
      var selectionText = Read(SystemColors.SelectionText);

      var background = Contrast(field, text) >= 3f ? field : chrome;
      if (Contrast(background, text) < 3f)
        background = Luminance(text) > .5f
          ? new Rgb(.11f, .11f, .12f)
          : new Rgb(1f, 1f, 1f);
      var dark = Luminance(background) < .5f;
      var control = Contrast(chrome, text) >= 3f ? chrome : background;
      var font = Rhino.Resources.EtoFonts.NormalFont;
      var family = SanitizeFamily(font.FamilyName);

      var tokens = new Dictionary<string, string>
      {
        { "bg", Hex(background) },
        { "surface", Hex(Mix(background, text, dark ? .05f : .035f)) },
        { "surface-2", Hex(Mix(background, text, dark ? .07f : .05f)) },
        { "control", Hex(control) },
        { "control-hover", Hex(Mix(control, text, dark ? .10f : .08f)) },
        { "field", Hex(background) },
        { "text", Hex(text) },
        { "text-dim", Hex(dim) },
        { "border", Hex(border) },
        { "accent", Hex(accent) },
        { "accent-text", Hex(accentText) },
        { "accent-soft", Hex(Mix(background, accent, dark ? .22f : .13f)) },
        { "selection", Hex(selection) },
        { "selection-text", Hex(selectionText) },
        { "font", family.Length == 0
          ? "-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
          : "\"" + family + "\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif" },
        { "fs", font.Size.ToString("0.##", CultureInfo.InvariantCulture) + "px" },
      };
      var scheme = dark ? "dark" : "light";
      return "{\"scheme\":\"" + scheme + "\",\"tokens\":{" + string.Join(",",
        tokens.OrderBy(item => item.Key).Select(item => JsonString(item.Key)
          + ":" + JsonString(item.Value))) + "}}";
    }

    static Rgb Read(Color color)
    {
      return new Rgb(color.R, color.G, color.B);
    }

    static Rgb Paint(PaintColor color)
    {
      var value = AppearanceSettings.GetPaintColor(color);
      return new Rgb(value.R / 255f, value.G / 255f, value.B / 255f);
    }

    static float Luminance(Rgb color)
    {
      return .2126f * color.R + .7152f * color.G + .0722f * color.B;
    }

    static float Contrast(Rgb first, Rgb second)
    {
      var firstLightness = RelativeLuminance(first);
      var secondLightness = RelativeLuminance(second);
      return (Math.Max(firstLightness, secondLightness) + .05f)
        / (Math.Min(firstLightness, secondLightness) + .05f);
    }

    static float RelativeLuminance(Rgb color)
    {
      return .2126f * Linear(color.R) + .7152f * Linear(color.G)
        + .0722f * Linear(color.B);
    }

    static float Linear(float channel)
    {
      return channel <= .03928f ? channel / 12.92f
        : (float)Math.Pow((channel + .055f) / 1.055f, 2.4f);
    }

    static Rgb Mix(Rgb from, Rgb to, float amount)
    {
      var value = Math.Max(0f, Math.Min(1f, amount));
      return new Rgb(
        from.R + (to.R - from.R) * value,
        from.G + (to.G - from.G) * value,
        from.B + (to.B - from.B) * value);
    }

    static string Hex(Rgb color)
    {
      return "#" + Channel(color.R).ToString("X2") + Channel(color.G).ToString("X2")
        + Channel(color.B).ToString("X2");
    }

    static int Channel(float value)
    {
      return (int)Math.Round(Math.Max(0f, Math.Min(1f, value)) * 255f);
    }

    static string SanitizeFamily(string value)
    {
      return new string((value ?? string.Empty).Where(character =>
        char.IsLetterOrDigit(character) || character == ' ' || character == '-'
        || character == '_' || character == '.').ToArray()).Trim();
    }

    static string JsonString(string value)
    {
      return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    struct Rgb
    {
      internal Rgb(float red, float green, float blue)
      {
        R = red;
        G = green;
        B = blue;
      }
      internal float R;
      internal float G;
      internal float B;
    }
  }
}
