from __future__ import annotations

import json

from opencam.schemas.cam import build_frontend_cam_schema_bundle


if __name__ == "__main__":
    bundle = build_frontend_cam_schema_bundle()
    print(json.dumps(bundle.model_dump(mode="json", by_alias=True), indent=2))
