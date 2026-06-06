from pathlib import Path
import sys

import uvicorn

SRC_DIR = Path(__file__).resolve().parent / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

if __name__ == "__main__":
    uvicorn.run("server.main:app", host="0.0.0.0", port=9090)
