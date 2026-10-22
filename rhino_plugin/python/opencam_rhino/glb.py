"""Minimal stdlib binary-glTF (GLB) mesh reader for Rhino's CPython runtime.

Only triangle primitives are supported: POSITION, optional indices, and the
optional COLOR_0 vertex-color attribute used by the comparison meshes.  This
intentionally depends on nothing beyond ``json`` and ``struct`` so it runs
inside Rhino 8's Python 3.9 runtime as well as the host test suite.
"""

from __future__ import annotations

import json
import struct

_MAGIC = 0x46546C67
_CHUNK_JSON = 0x4E4F534A
_CHUNK_BIN = 0x004E4942

_FLOAT = 5126
_UNSIGNED_INT = 5125
_UNSIGNED_SHORT = 5123
_UNSIGNED_BYTE = 5121

_COMPONENT_SIZES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
_COMPONENT_CHARS = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
_VECTOR_LENGTHS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def parse_glb(data: bytes, *, allow_empty: bool = False) -> list[dict]:
    """Return ``[{vertices, faces, colors?}, ...]`` for every triangle mesh.

    Empty GLBs represent an absent optional simulation overlay. Callers must
    opt in because a tool mesh and other required geometry must have triangles.
    """
    if len(data) < 12:
        raise ValueError("GLB payload is too short.")
    magic, _version, total = struct.unpack_from("<III", data, 0)
    if magic != _MAGIC:
        raise ValueError("Payload is not a binary glTF (GLB) file.")
    if total > len(data):
        raise ValueError("GLB header length exceeds the payload size.")

    document = None
    binary = b""
    offset = 12
    while offset + 8 <= total:
        length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset : offset + length]
        offset += length
        if chunk_type == _CHUNK_JSON:
            document = json.loads(chunk.decode("utf-8"))
        elif chunk_type == _CHUNK_BIN:
            binary = chunk
    if document is None:
        raise ValueError("GLB is missing its JSON chunk.")

    meshes = []
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            if primitive.get("mode", 4) != 4:
                continue
            parsed = _parse_primitive(document, binary, primitive)
            if parsed is not None and parsed["faces"]:
                meshes.append(parsed)
    if not meshes and not allow_empty:
        raise ValueError("GLB contains no triangle meshes.")
    return meshes


def _parse_primitive(document: dict, binary: bytes, primitive: dict) -> dict | None:
    attributes = primitive.get("attributes", {})
    if "POSITION" not in attributes:
        return None
    positions, position_type = _read_accessor(document, binary, attributes["POSITION"])
    if position_type != _FLOAT:
        raise ValueError("Only float POSITION attributes are supported.")

    indices_attribute = primitive.get("indices")
    if indices_attribute is None:
        face_count = len(positions) // 3
        faces = [(index * 3, index * 3 + 1, index * 3 + 2) for index in range(face_count)]
    else:
        raw_indices, index_type = _read_accessor(document, binary, indices_attribute)
        if index_type not in {_UNSIGNED_BYTE, _UNSIGNED_SHORT, _UNSIGNED_INT}:
            raise ValueError("Only unsigned integer index attributes are supported.")
        flat = [value for vector in raw_indices for value in vector]
        face_count = len(flat) // 3
        faces = [(flat[i], flat[i + 1], flat[i + 2]) for i in range(0, face_count * 3, 3)]

    colors = None
    if "COLOR_0" in attributes:
        raw_colors, color_type = _read_accessor(document, binary, attributes["COLOR_0"])
        if len(raw_colors) == len(positions):
            colors = [
                (
                    _color_byte(vector[0], color_type),
                    _color_byte(vector[1], color_type),
                    _color_byte(vector[2], color_type),
                )
                for vector in raw_colors
            ]

    return {
        "vertices": [(vector[0], vector[1], vector[2]) for vector in positions],
        "faces": faces,
        "colors": colors,
    }


def _read_accessor(document: dict, binary: bytes, accessor_index: int):
    accessor = document["accessors"][accessor_index]
    component_type = accessor["componentType"]
    count = accessor["count"]
    vector_length = _VECTOR_LENGTHS[accessor["type"]]
    view_index = accessor.get("bufferView")
    if view_index is None:
        return [(0.0,) * vector_length] * count, component_type

    view = document["bufferViews"][view_index]
    item_size = _COMPONENT_SIZES[component_type] * vector_length
    stride = view.get("byteStride") or item_size
    base = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    fmt = "<" + _COMPONENT_CHARS[component_type] * vector_length
    if base + (count - 1) * stride + item_size > len(binary):
        raise ValueError("GLB accessor extends past the binary chunk.")
    return [struct.unpack_from(fmt, binary, base + index * stride) for index in range(count)], component_type


def _color_byte(value: float, component_type: int) -> int:
    if component_type in {_UNSIGNED_BYTE, 5121}:
        return max(0, min(255, int(value)))
    return max(0, min(255, int(round(float(value) * 255.0))))
