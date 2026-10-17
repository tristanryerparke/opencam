"""Build validated API operation payloads from panel operation specs.

Pure functions only: no Rhino imports, so the host test suite covers the exact
payloads the panel will send to ``POST /cam/toolpath``.
"""

from __future__ import annotations

OPERATION_TYPES = ("pocketing_2d", "profiling_2d", "parallel_finishing")
WORLD_XY_TOLERANCE = 1e-6


def default_params(operation_type: str) -> dict:
    common = {
        "tool_name": "Flat end mill",
        "tool_number": 1,
        "tool_diameter": 6.0,
        "cutting_height": 12.0,
        "stepover_percent": 40.0,
        "depth_of_cut": 2.0,
        "max_stepdown": 10.0,
        "cut_feedrate": 800.0,
        "plunge_feedrate": 250.0,
        "spindle_rpm": 18000,
        "stock_to_leave": 0.0,
        "cut_direction": "climb",
        "clearance_offset": 10.0,
    }
    per_type = {
        "pocketing_2d": {"clearing_strategy": "offset", "keep_tool_down": True},
        "profiling_2d": {"side": "inside"},
        "parallel_finishing": {"direction_degrees": 0.0},
    }
    if operation_type not in per_type:
        raise ValueError("Unknown operation type: {}".format(operation_type))
    return dict(common, **per_type[operation_type])


def build_operation_payload(spec: dict, document_state) -> dict:
    operation_type = spec["type"]
    params = dict(default_params(operation_type), **spec.get("params", {}))
    payload = {
        "type": operation_type,
        "id": spec["id"],
        "displayName": spec.get("name") or operation_type,
        "tool": {
            "type": "cylinder",
            "name": params["tool_name"],
            "toolNumber": int(params["tool_number"]),
            "diameter": float(params["tool_diameter"]),
            "cuttingHeight": float(params["cutting_height"]),
            "shoulderHeight": float(params["cutting_height"]),
        },
        "feedsAndSpeeds": {
            "spindleRpm": int(params["spindle_rpm"]),
            "plungeFeedrate": float(params["plunge_feedrate"]),
            "cutFeedrate": float(params["cut_feedrate"]),
        },
        "clearance": {"clearanceHeightType": "stock_max_z_plus_offset", "offset": float(params["clearance_offset"])},
        "levels": {
            "driveGeometryPosition": "at_top",
            "depthOfCut": float(params["depth_of_cut"]),
            "maxStepdown": float(params["max_stepdown"]),
        },
        "advanced": {"operationsSorting": "selection", "chordalTolerance": 0.01},
    }
    if operation_type == "pocketing_2d":
        payload["driveGeometry"] = _drive_geometry_25d(document_state)
        payload["cutParameters"] = {
            "clearingStrategy": params["clearing_strategy"],
            "keepToolDown": bool(params["keep_tool_down"]),
            "cutDirection": params["cut_direction"],
            "stepover": _stepover(params),
            "stockToLeave": float(params["stock_to_leave"]),
        }
    elif operation_type == "profiling_2d":
        payload["driveGeometry"] = _drive_geometry_25d(document_state)
        payload["cutParameters"] = {
            "side": params["side"],
            "cutDirection": params["cut_direction"],
            "stockToLeave": float(params["stock_to_leave"]),
        }
    else:
        payload["driveGeometry"] = _drive_geometry_2d(document_state)
        payload["cutParameters"] = {
            "cutDirection": params["cut_direction"],
            "directionDegrees": float(params["direction_degrees"]),
            "stepover": _stepover(params),
            "stockToLeave": float(params["stock_to_leave"]),
        }
    return payload


def _stepover(params: dict) -> dict:
    return {"mode": "percentage_of_tool_diameter", "value": float(params["stepover_percent"])}


def _region(document_state) -> dict:
    region = document_state.region
    if region is None:
        raise ValueError("Select a planar region before generating this operation.")
    normal = region.plane.get("normal", (0.0, 0.0, 1.0))
    if (
        abs(normal[0]) > WORLD_XY_TOLERANCE
        or abs(normal[1]) > WORLD_XY_TOLERANCE
        or abs(normal[2] - 1.0) > WORLD_XY_TOLERANCE
    ):
        raise ValueError(
            "The selected region is not parallel to World XY; setup transforms are not implemented yet."
        )
    return region


def _drive_geometry_25d(document_state) -> list[dict]:
    region = _region(document_state)
    z = float(region.plane["origin"][2])
    loops = [region.outer_loop] + list(region.inner_loops)
    return [
        {"z": z, "vertices": [{"x": x, "y": y} for x, y, _z in loop]} for loop in loops
    ]


def _drive_geometry_2d(document_state) -> list[dict]:
    region = _region(document_state)
    return [{"vertices": [{"x": x, "y": y} for x, y, _z in region.outer_loop]}]
