"""Build validated API operation payloads from panel operation specs.

Pure functions only: no Rhino imports, so the host test suite covers the exact
payloads the panel will send to ``POST /cam/toolpath``.
"""

from __future__ import annotations

OPERATION_TYPES = (
    "pocketing_2d",
    "profiling_2d",
    "facing_2d",
    "parallel_finishing",
)
WORLD_XY_TOLERANCE = 1e-6


def default_params(operation_type: str) -> dict:
    common = {
        "tool_name": "Flat end mill",
        "tool_number": 1,
        "tool_diameter": 6.0,
        "cutting_height": 12.0,
        "shoulder_height": 12.0,
        "num_flutes": 2,
        "stepover_percent": 40.0,
        "depth_of_cut": 2.0,
        "max_stepdown": 10.0,
        "drive_geometry_position": "at_bottom",
        "cut_feedrate": 800.0,
        "plunge_feedrate": 250.0,
        "lead_in_feedrate": 800.0,
        "lead_out_feedrate": 800.0,
        "departure_feedrate": 800.0,
        "spindle_rpm": 18000,
        "stock_to_leave": 0.0,
        "cut_direction": "climb",
        "clearance_type": "stock_max_z_plus_offset",
        "clearance_offset": 10.0,
        "absolute_clearance_height": 25.4,
        "operations_sorting": "selection",
        "chordal_tolerance": 0.01,
    }
    per_type = {
        "pocketing_2d": {"clearing_strategy": "offset", "keep_tool_down": True},
        "profiling_2d": {"side": "outside"},
        "facing_2d": {
            "cut_direction": "mixed",
            "direction_degrees": 0.0,
            "edge_overtravel": 0.0,
        },
        "parallel_finishing": {"direction_degrees": 0.0},
    }
    if operation_type not in per_type:
        raise ValueError(f"Unknown operation type: {operation_type}")
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
            "shoulderHeight": float(params["shoulder_height"]),
            "numFlutes": float(params["num_flutes"]),
        },
        "feedsAndSpeeds": {
            "spindleRpm": int(params["spindle_rpm"]),
            "plungeFeedrate": float(params["plunge_feedrate"]),
            "leadInFeedrate": float(params["lead_in_feedrate"]),
            "cutFeedrate": float(params["cut_feedrate"]),
            "leadOutFeedrate": float(params["lead_out_feedrate"]),
            "departureFeedrate": float(params["departure_feedrate"]),
        },
        "clearance": _clearance(params),
        "levels": {
            "driveGeometryPosition": params["drive_geometry_position"],
            "depthOfCut": float(params["depth_of_cut"]),
            "maxStepdown": float(params["max_stepdown"]),
        },
        "advanced": {
            "operationsSorting": params["operations_sorting"],
            "chordalTolerance": float(params["chordal_tolerance"]),
        },
    }
    if params.get("tool_id"):
        payload["tool"]["id"] = str(params["tool_id"])
    regions = spec.get("regions")
    if regions is None:
        regions = [spec["region"]] if spec.get("region") is not None else []
    if operation_type == "pocketing_2d":
        payload["driveGeometry"] = _drive_geometry_25d(regions)
        payload["cutParameters"] = {
            "clearingStrategy": params["clearing_strategy"],
            "keepToolDown": bool(params["keep_tool_down"]),
            "cutDirection": params["cut_direction"],
            "stepover": _stepover(params),
            "stockToLeave": float(params["stock_to_leave"]),
        }
    elif operation_type == "profiling_2d":
        payload["driveGeometry"] = _drive_geometry_25d(regions)
        payload["cutParameters"] = {
            "side": params["side"],
            "cutDirection": params["cut_direction"],
            "stockToLeave": float(params["stock_to_leave"]),
        }
    elif operation_type == "facing_2d":
        payload["driveGeometry"] = _facing_drive_geometry(regions)
        payload["cutParameters"] = {
            "cutDirection": params["cut_direction"],
            "directionDegrees": float(params["direction_degrees"]),
            "edgeOvertravel": float(params["edge_overtravel"]),
            "stepover": _stepover(params),
        }
    else:
        payload["driveGeometry"] = _drive_geometry_2d(regions)
        payload["cutParameters"] = {
            "cutDirection": params["cut_direction"],
            "directionDegrees": float(params["direction_degrees"]),
            "stepover": _stepover(params),
            "stockToLeave": float(params["stock_to_leave"]),
        }
    return payload


def _clearance(params: dict) -> dict:
    clearance_type = params["clearance_type"]
    if clearance_type == "automatic":
        return {"clearanceHeightType": clearance_type}
    if clearance_type == "absolute":
        return {"clearanceHeightType": clearance_type, "absoluteHeight": float(params["absolute_clearance_height"])}
    return {"clearanceHeightType": clearance_type, "offset": float(params["clearance_offset"])}


def _stepover(params: dict) -> dict:
    return {"mode": "percentage_of_tool_diameter", "value": float(params["stepover_percent"])}


def _region(region) -> dict:
    if region is None:
        raise ValueError("Select a planar region in this operation before generating.")
    if hasattr(region, "plane"):
        region = {
            "plane": region.plane,
            "outer_loop": region.outer_loop,
            "inner_loops": region.inner_loops,
        }
    normal = region["plane"].get("normal", (0.0, 0.0, 1.0))
    if (
        abs(normal[0]) > WORLD_XY_TOLERANCE
        or abs(normal[1]) > WORLD_XY_TOLERANCE
        or abs(abs(normal[2]) - 1.0) > WORLD_XY_TOLERANCE
    ):
        raise ValueError(
            "The selected region is not parallel to World XY; setup transforms are not implemented yet."
        )
    return region


def _regions(values) -> list[dict]:
    if not values:
        raise ValueError("Select at least one planar region in this operation before generating.")
    return [_region(value) for value in values]


def _drive_geometry_25d(values) -> list[dict]:
    geometry = []
    for region in _regions(values):
        z = float(region["plane"]["origin"][2])
        for loop in [region["outer_loop"]] + list(region["inner_loops"]):
            geometry.append({"z": z, "vertices": [{"x": x, "y": y} for x, y, _z in loop]})
    return geometry


def _facing_drive_geometry(values) -> list[dict]:
    regions = _regions(values)
    if len(regions) != 1 or regions[0]["inner_loops"]:
        raise ValueError("Facing requires one region without inner loops.")
    region = regions[0]
    return [{
        "z": float(region["plane"]["origin"][2]),
        "vertices": [{"x": x, "y": y} for x, y, _z in region["outer_loop"]],
    }]


def _drive_geometry_2d(values) -> list[dict]:
    return [
        {"vertices": [{"x": x, "y": y} for x, y, _z in region["outer_loop"]]}
        for region in _regions(values)
    ]
