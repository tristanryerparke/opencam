"""Inspect original CL move for a frontend simulation's displayed frame number."""

import argparse
import json
from pathlib import Path

RUN_LOG_DIR = Path(__file__).resolve().parents[1] / "toolpath-runs"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "simulation_id", help="Full simulation ID or visible Sim prefix"
    )
    parser.add_argument(
        "frame", type=int, help="1-based frame number shown in frontend"
    )
    args = parser.parse_args()

    matches = list(RUN_LOG_DIR.glob(f"*/frame-map-{args.simulation_id}*.json"))
    if len(matches) != 1:
        parser.error(f"Expected one matching simulation, found {len(matches)}.")
    mapping_path = matches[0]
    mapping = json.loads(mapping_path.read_text(encoding="utf-8"))
    frame_index = args.frame - mapping["displayedFrameNumberOffset"]
    frame_to_record = mapping["frameToClRecord"]
    if not 0 <= frame_index < len(frame_to_record):
        parser.error(f"Frame must be between 1 and {len(frame_to_record)}.")

    cl = json.loads(
        (mapping_path.parent / mapping["clFile"]).read_text(encoding="utf-8")
    )
    record_index = frame_to_record[frame_index]
    print(f"Run: {mapping['runId']}")
    print(f"Simulation: {mapping['simulationId']}")
    print(f"Displayed frame: {args.frame} / {len(frame_to_record)}")
    print(f"CL record index (zero-based): {record_index} / {len(cl['records'])}")
    if record_index > 0:
        print("Previous CL record (move start):")
        print(json.dumps(cl["records"][record_index - 1], indent=2))
    print("CL record (move end):")
    print(json.dumps(cl["records"][record_index], indent=2))


if __name__ == "__main__":
    main()
