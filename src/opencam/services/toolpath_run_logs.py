"""Local, gitignored CL and simulation provenance for reported frame defects."""

import json
from pathlib import Path
from uuid import UUID, uuid4

from opencam_contracts.cam import GenerateToolpathRequest
from opencam_contracts.cl_data import OperationRecord3D
from opencam_contracts.mesh import CachedMesh, CachedMeshLoader, resolve_part_mesh

RUN_LOG_DIR = Path(__file__).resolve().parents[3] / "toolpath-runs"


def _run_directory(run_id: str) -> Path:
    parsed = UUID(run_id)
    if str(parsed) != run_id:
        raise ValueError("Run ID must be a canonical UUID.")
    return RUN_LOG_DIR / run_id


def log_generated_cl(
    operation: OperationRecord3D,
    *,
    request: GenerateToolpathRequest | None = None,
    cached_mesh_loader: CachedMeshLoader | None = None,
) -> str:
    run_id = str(uuid4())
    directory = _run_directory(run_id)
    replay_request = None
    if request is not None and isinstance(request.setup.part_mesh, CachedMesh):
        replay_setup = request.setup.model_copy(deep=True)
        replay_setup.part_mesh = resolve_part_mesh(
            request.setup.part_mesh, cached_mesh_loader=cached_mesh_loader
        )
        replay_request = request.model_copy(update={"setup": replay_setup})

    directory.mkdir(parents=True, exist_ok=False)
    (directory / "cl.json").write_text(
        operation.model_dump_json(by_alias=True, indent=2) + "\n",
        encoding="utf-8",
    )
    if request is not None:
        (directory / "request.json").write_text(
            request.model_dump_json(by_alias=True, indent=2) + "\n",
            encoding="utf-8",
        )
    if replay_request is not None:
        (directory / "replay-request.json").write_text(
            replay_request.model_dump_json(by_alias=True, indent=2) + "\n",
            encoding="utf-8",
        )
    return run_id


def ensure_logged_cl(operation: OperationRecord3D, run_id: str | None) -> str:
    """Validate frontend provenance, or log standalone simulation uploads."""
    if run_id is None:
        return log_generated_cl(operation)
    path = _run_directory(run_id) / "cl.json"
    if not path.is_file():
        raise ValueError(f"No logged CL found for run {run_id}.")
    logged = OperationRecord3D.model_validate_json(path.read_text(encoding="utf-8"))
    if logged.model_dump(mode="json") != operation.model_dump(mode="json"):
        raise ValueError(f"Submitted CL differs from logged run {run_id}.")
    return run_id


def log_simulation_frames(
    run_id: str, simulation_id: str, cl_record_indices: list[int]
) -> None:
    directory = _run_directory(run_id)
    if not (directory / "cl.json").is_file():
        raise ValueError(f"No logged CL found for run {run_id}.")
    # Reruns of the same CL keep independent frame maps.
    (directory / f"frame-map-{simulation_id}.json").write_text(
        json.dumps(
            {
                "runId": run_id,
                "simulationId": simulation_id,
                "clFile": "cl.json",
                "indexBase": 0,
                "displayedFrameNumberOffset": 1,
                "frameToClRecord": cl_record_indices,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
