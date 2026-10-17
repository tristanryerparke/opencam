"""Small standard-library HTTP client for the existing OpenCAM API."""

from __future__ import annotations

import json
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
