"""Small standard-library HTTP client for the existing OpenCAM API."""

from __future__ import annotations

import json
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def request_json(base_url: str, method: str, path: str, payload: dict | None = None, timeout: float = 120.0):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        base_url.rstrip("/") + path,
        data=body,
        method=method,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - endpoint is user-configured local backend
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError("OpenCAM backend {}: {}".format(error.code, detail)) from error
    except URLError as error:
        raise RuntimeError("OpenCAM backend unavailable: {}".format(error.reason)) from error


def post_json_bytes(
    base_url: str,
    path: str,
    payload,
    timeout: float = 120.0,
) -> bytes:
    request = Request(
        base_url.rstrip("/") + path,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Accept": "text/plain", "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - local user-configured backend
            return response.read()
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError("OpenCAM backend {}: {}".format(error.code, detail)) from error
    except URLError as error:
        raise RuntimeError("OpenCAM backend unavailable: {}".format(error.reason)) from error


def request_bytes(base_url: str, path: str, timeout: float = 300.0) -> bytes:
    request = Request(
        base_url.rstrip("/") + path,
        method="GET",
        headers={"Accept": "application/octet-stream, model/gltf-binary, application/json"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - local user-configured backend
            return response.read()
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError("OpenCAM backend {}: {}".format(error.code, detail)) from error
    except URLError as error:
        raise RuntimeError("OpenCAM backend unavailable: {}".format(error.reason)) from error


def start_swept_simulation(
    base_url: str,
    stock_stl: bytes,
    operation_json: str,
    timeout: float = 120.0,
) -> str:
    """POST /simulate with a stock STL and generated CL data; returns a task id."""
    boundary = "----OpenCAMRhino" + uuid.uuid4().hex
    body = bytearray()

    def field(name: str, value: str) -> None:
        body.extend(
            ("--{}\r\n".format(boundary)
             + 'Content-Disposition: form-data; name="{}"\r\n\r\n'.format(name)
             + value
             + "\r\n").encode("utf-8")
        )

    field("operation", operation_json)
    body.extend(
        ("--{}\r\n".format(boundary)
         + 'Content-Disposition: form-data; name="mesh"; filename="stock.stl"\r\n'
         + "Content-Type: model/stl\r\n\r\n").encode("utf-8")
    )
    body.extend(stock_stl)
    body.extend(("\r\n--{}--\r\n".format(boundary)).encode("utf-8"))

    request = Request(
        base_url.rstrip("/") + "/simulate",
        data=bytes(body),
        method="POST",
        headers={
            "Content-Type": "multipart/form-data; boundary={}".format(boundary),
            "Accept": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - local user-configured backend
            return str(json.loads(response.read().decode("utf-8"))["taskId"])
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError("OpenCAM backend {}: {}".format(error.code, detail)) from error
    except URLError as error:
        raise RuntimeError("OpenCAM backend unavailable: {}".format(error.reason)) from error
