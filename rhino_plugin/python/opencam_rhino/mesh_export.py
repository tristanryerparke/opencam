"""Binary STL export of the stock box derived from a selected part."""

from __future__ import annotations

import struct


def box_stl_bytes(min_point, max_point) -> bytes:
    """Return a watertight binary STL box for the world-axis stock bounds."""
    x0, y0, z0 = min_point
    x1, y1, z1 = max_point
    corners = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ]
    quads = (
        ((0, 3, 2, 1), (0.0, 0.0, -1.0)),
        ((4, 5, 6, 7), (0.0, 0.0, 1.0)),
        ((0, 1, 5, 4), (0.0, -1.0, 0.0)),
        ((2, 3, 7, 6), (0.0, 1.0, 0.0)),
        ((1, 2, 6, 5), (1.0, 0.0, 0.0)),
        ((3, 0, 4, 7), (-1.0, 0.0, 0.0)),
    )
    triangles = []
    for indices, normal in quads:
        a, b, c, d = (corners[index] for index in indices)
        triangles.append((normal, a, b, c))
        triangles.append((normal, a, c, d))

    payload = bytearray(80)
    payload += struct.pack("<I", len(triangles))
    for normal, a, b, c in triangles:
        payload += struct.pack("<3f", *normal)
        payload += struct.pack("<3f", *a)
        payload += struct.pack("<3f", *b)
        payload += struct.pack("<3f", *c)
        payload += b"\x00\x00"
    return bytes(payload)
