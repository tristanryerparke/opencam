#!/usr/bin/env python3
"""Convert a Rhino layout-print icon PDF into the shared OpenCAM icon SVG format.

Pipeline: inkscape PDF -> SVG, then every path's d-string is scaled to an
output viewBox and strokes are normalized: part geometry becomes one black
path at width 2, toolpath geometry becomes one ``#0066ff`` path at width 1.5.

Use the default 72-unit viewBox for standard 25.4 mm icons. Use
``--viewbox 90`` for the 31.75 mm facing export, then display that SVG at
1.25× normal CSS size. This keeps its center geometry and lineweights equal
to the standard icons while retaining outer toolpaths.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import tempfile
from pathlib import Path
from xml.etree import ElementTree

SVG_NS = "http://www.w3.org/2000/svg"
INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape"

COMMAND = re.compile(r"([MmLlVvHhZzAa])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)")

VIEWBOX = 72
PART_COLOR = "#000"
PART_WIDTH = 2
TOOLPATH_COLOR = "#0066ff"
TOOLPATH_WIDTH = 1.5


def transform_d(d: str, s: float) -> str:
    """Scale every coordinate in d by s (arc radii scale; flags and rotations stay)."""
    out: list[str] = []
    current = ""
    numbers: list[float] = []

    def scaled(value: float) -> str:
        return repr(value * s)

    def flush() -> None:
        nonlocal numbers
        if not numbers:
            return
        values = numbers
        numbers = []
        rendered: list[str] = []
        if current in {"A", "a"}:
            for group_index, value in enumerate(values):
                position = group_index % 7
                if position in {2, 3, 4}:  # rotation and the two flags
                    rendered.append(repr(value))
                else:
                    rendered.append(scaled(value))
        else:
            rendered.extend(scaled(value) for value in values)
        out.append(" ".join(rendered))

    for match in COMMAND.finditer(d):
        command, number = match.group(1), match.group(2)
        if command is not None:
            flush()
            current = command
            out.append(command)
        else:
            numbers.append(float(number))
    flush()
    return "".join(out)


def layer_labels(element: ElementTree.Element) -> list[str]:
    labels = []
    node = element
    while node is not None:
        label = node.get(f"{{{INKSCAPE_NS}}}label")
        if label:
            labels.append(label)
        node = _parent_map.get(node)
    return labels


def run_inkscape(pdf_path: Path, svg_path: Path) -> None:
    result = subprocess.run(
        ["inkscape", str(pdf_path), "--export-type=svg", f"--export-filename={svg_path}"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not svg_path.exists():
        raise RuntimeError(f"inkscape failed: {result.stderr.strip()}")


def _stroke_width(element: ElementTree.Element) -> float:
    style = element.get("style", "")
    match = re.search(r"stroke-width:([\d.]+)", style)
    return float(match.group(1)) if match else 1.0


def element_scale(element: ElementTree.Element) -> float:
    """Uniform scale from a path's own transform (scale(k) only)."""
    transform = element.get("transform")
    if not transform:
        return 1.0
    match = re.fullmatch(r"scale\(([-\d.eE]+)(?:,\s*([-\d.eE]+))?\)", transform.strip())
    if match is None:
        raise RuntimeError(f"Unsupported path transform: {transform!r}")
    kx = float(match.group(1))
    ky = float(match.group(2) or match.group(1))
    if abs(kx - ky) > 1e-9:
        raise RuntimeError(f"Non-uniform path transform: {transform!r}")
    return kx


def convert(pdf_path: Path, viewbox: float, scale: float) -> str:
    with tempfile.TemporaryDirectory() as temp_dir:
        raw_svg = Path(temp_dir) / "raw.svg"
        run_inkscape(pdf_path, raw_svg)
        global _parent_map
        tree = ElementTree.parse(raw_svg)
        root = tree.getroot()
        source_viewbox = root.get("viewBox", "").split()
        if len(source_viewbox) != 4:
            raise RuntimeError("Inkscape SVG has no usable viewBox.")
        source_width = float(source_viewbox[2])
        if source_width <= 0:
            raise RuntimeError("Inkscape SVG has an invalid viewBox width.")
        output_scale = viewbox / source_width * scale
        _parent_map = {child: parent for parent in tree.iter() for child in parent}

        part_segments: list[str] = []
        toolpath_segments: list[str] = []
        for element in tree.iter(f"{{{SVG_NS}}}path"):
            d = element.get("d")
            if not d:
                continue
            stroke_width = _stroke_width(element)
            scaled = transform_d(d, element_scale(element) * output_scale)
            is_toolpath = any(label == "TOOLPATH" for label in layer_labels(element)) and stroke_width < 0.5
            if is_toolpath:
                toolpath_segments.append(scaled)
            else:
                part_segments.append(scaled)

    if not part_segments:
        raise RuntimeError("No part-geometry strokes found.")

    paths = [f'<path stroke="{PART_COLOR}" d="{"".join(part_segments)}"/>']
    if toolpath_segments:
        paths.append(
            f'<path stroke="{TOOLPATH_COLOR}" stroke-width="{TOOLPATH_WIDTH}" d="{"".join(toolpath_segments)}"/>'
        )
    body = "\n    ".join(paths)
    return (
        f'<svg xmlns="{SVG_NS}" viewBox="0 0 {viewbox:g} {viewbox:g}" height="{300 * viewbox / VIEWBOX:g}px" width="{300 * viewbox / VIEWBOX:g}px">\n'
        f'  <g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="{PART_WIDTH}">\n'
        f"    {body}\n"
        "  </g>\n"
        "</svg>\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--viewbox",
        type=float,
        default=VIEWBOX,
        help="Square output viewBox width and height. Default: 72.",
    )
    parser.add_argument(
        "--scale",
        type=float,
        default=1.0,
        help="Extra scale after output-viewBox normalization.",
    )
    args = parser.parse_args()
    args.output.write_text(convert(args.pdf, args.viewbox, args.scale))
    print(f"wrote {args.output}")


if __name__ == "__main__":
    main()
