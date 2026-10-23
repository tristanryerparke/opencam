from __future__ import annotations

import os
from pathlib import Path
from threading import Lock
from typing import Any

from pydantic import TypeAdapter
from tinydb import Query, TinyDB
from tinydb.table import Table

from opencam_contracts.tools import Tool

TOOL_ADAPTER = TypeAdapter(Tool)

DEFAULT_TOOL_LIBRARY_PATH = Path(__file__).resolve().parents[3] / "opencam-tinydb.json"
TOOL_LIBRARY_PATH_ENV = "OPENCAM_TINYDB_PATH"


class ToolLibrary:
    """TinyDB-backed store for tool records."""

    def __init__(self, path: str | os.PathLike[str] | None = None, *, db: TinyDB | None = None):
        self._owns_db = db is None
        if db is None:
            db_path = Path(path or os.environ.get(TOOL_LIBRARY_PATH_ENV) or DEFAULT_TOOL_LIBRARY_PATH)
            db_path.parent.mkdir(parents=True, exist_ok=True)
            db = TinyDB(db_path, indent=2)

        self._db = db
        self._lock = Lock()
        self._tools = self._db.table("tools")

    def close(self) -> None:
        if self._owns_db:
            self._db.close()

    def list_tools(self) -> list[Tool]:
        with self._lock:
            return [self._parse_tool_row(row) for row in self._tools.all()]

    def get_tool(self, tool_id: str) -> Tool | None:
        with self._lock:
            row = self._get_by_id(self._tools, tool_id)
            return self._parse_tool_row(row) if row is not None else None

    def add_tool(self, tool: Tool) -> Tool:
        with self._lock:
            self._insert_unique_id(self._tools, tool.model_dump(mode="json", by_alias=True))
            return tool

    def update_tool(self, tool_id: str, tool: Tool) -> Tool | None:
        with self._lock:
            if self._get_by_id(self._tools, tool_id) is None:
                return None
            record = Query()
            self._tools.update(tool.model_dump(mode="json", by_alias=True), record.id == tool_id)
            return tool

    def delete_tool(self, tool_id: str) -> bool:
        with self._lock:
            record = Query()
            deleted_ids = self._tools.remove(record.id == tool_id)
            return len(deleted_ids) > 0

    @staticmethod
    def _parse_tool_row(row: dict[str, Any]) -> Tool:
        return TOOL_ADAPTER.validate_python(row)

    @staticmethod
    def _get_by_id(table: Table, record_id: str) -> dict[str, Any] | None:
        record = Query()
        return table.get(record.id == record_id)

    @staticmethod
    def _insert_unique_id(table: Table, payload: dict[str, Any]) -> None:
        record = Query()
        if table.contains(record.id == payload["id"]):
            raise ValueError(f"Record with id {payload['id']!r} already exists.")
        table.insert(payload)


_TOOL_LIBRARY: ToolLibrary | None = None
_TOOL_LIBRARY_LOCK = Lock()


def get_tool_library() -> ToolLibrary:
    global _TOOL_LIBRARY
    with _TOOL_LIBRARY_LOCK:
        if _TOOL_LIBRARY is None:
            _TOOL_LIBRARY = ToolLibrary()
        return _TOOL_LIBRARY
