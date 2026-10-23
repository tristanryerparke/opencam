from __future__ import annotations

import json

from opencam_contracts.cam import build_frontend_cam_schema_bundle


if __name__ == "__main__":
    bundle = build_frontend_cam_schema_bundle()
    print(json.dumps(bundle, indent=2))
