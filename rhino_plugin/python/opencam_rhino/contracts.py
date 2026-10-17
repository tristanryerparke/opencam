"""Versioned, host-independent messages shared by the Rhino panel and actions."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

PROTOCOL_VERSION = 1
DOCUMENT_SCHEMA_VERSION = 2

DEFAULT_VISIBILITY = {"stock": True, "part": True, "toolpath": True, "tool": True}


@dataclass
class StockBox:
    min: list[float]
    max: list[float]


@dataclass
class PartSelection:
    object_id: str
    name: str
    mesh: dict[str, Any]
    stock_box: StockBox


@dataclass
class PlanarRegion:
    source_object_ids: list[str]
    plane: dict[str, list[float]]
    outer_loop: list[list[float]]
    inner_loops: list[list[list[float]]] = field(default_factory=list)


@dataclass
class OperationSpec:
    id: str
    name: str
    type: str
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class SetupSpec:
    id: str
    name: str
    operations: list[OperationSpec] = field(default_factory=list)


@dataclass
class DocumentState:
    schema_version: int = DOCUMENT_SCHEMA_VERSION
    backend_url: str = "http://127.0.0.1:9090"
    part: PartSelection | None = None
    region: PlanarRegion | None = None
    setups: list[SetupSpec] = field(default_factory=list)
    selected_operation_id: str | None = None
    visibility: dict[str, bool] = field(default_factory=lambda: dict(DEFAULT_VISIBILITY))
    results: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def all_operations(self):
        for setup in self.setups:
            for operation in setup.operations:
                yield setup, operation

    def find_operation(self, operation_id: str):
        for setup, operation in self.all_operations():
            if operation.id == operation_id:
                return setup, operation
        return None, None


@dataclass
class PanelRequest:
    action: Literal[
        "get_state", "select_part", "select_region", "generate", "generate_operation",
        "add_setup", "add_operation", "update_operation", "delete_operation",
        "select_operation", "set_visibility", "set_backend_url",
        "simulate", "simulate_status", "show_frame", "compare", "show_final",
        "clear_preview", "post_process",
    ]
    request_id: str = ""
    payload: dict[str, Any] = field(default_factory=dict)
    protocol_version: int = PROTOCOL_VERSION

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PanelRequest":
        if data.get("protocol_version", PROTOCOL_VERSION) != PROTOCOL_VERSION:
            raise ValueError("Unsupported OpenCAM Rhino panel protocol version.")
        return cls(
            action=data["action"],
            request_id=str(data.get("request_id", "")),
            payload=dict(data.get("payload", {})),
        )


def panel_event(request: PanelRequest, state: DocumentState, **extra: Any) -> dict[str, Any]:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "request_id": request.request_id,
        "state": state.to_dict(),
        **extra,
    }
