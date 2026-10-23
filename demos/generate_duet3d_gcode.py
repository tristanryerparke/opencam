"""Post-process a saved OpenCAM cutter-location JSON file into Duet 3D G-code.

Usage:
    uv run demos/generate_duet3d_gcode.py path/to/cl.json [-o out.gcode]

The tool inside the CL file must match a tool in the backend tool library.
Edit `build_machine` below with the real machine travel, feed, and spindle limits.
"""

import argparse
from pathlib import Path

from opencam.post_processing.duet3d.models import build_default_duet3d_machine
from opencam.post_processing.duet3d.post_processor import Duet3DPostProcessor
from opencam_contracts.cl_data import OperationRecord3D
from opencam.services.tool_library import get_tool_library


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cl_json", type=Path, help="OperationRecord3D JSON file from the frontend")
    parser.add_argument("-o", "--output", type=Path, default=None, help="G-code output path")
    parser.add_argument(
        "-v", "--verbose-comments", action="store_true", help="Comment generic commands"
    )
    args = parser.parse_args()

    operation = OperationRecord3D.model_validate_json(args.cl_json.read_text())
    post_processor = Duet3DPostProcessor(
        build_default_duet3d_machine(), get_tool_library(), verbose_comments=args.verbose_comments
    )
    gcode = post_processor.post_process([operation], program_name=args.cl_json.stem)

    output = args.output if args.output is not None else args.cl_json.with_suffix(".gcode")
    output.write_text(gcode)
    print(f"Wrote {len(gcode.splitlines())} lines to {output}")


if __name__ == "__main__":
    main()
