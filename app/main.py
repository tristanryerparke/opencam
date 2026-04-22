from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import ToolpathOperation
from pocketing import ClosedPocketingEngine
from profiling import ClosedProfilingEngine

app = FastAPI(title="Time Tracker API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/test")
async def root():
    return {"message": "hello from web-app-template"}


@app.get("/ping")
async def ping():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.post("/profile/closed", response_model=ToolpathOperation)
async def profile_closed(engine: ClosedProfilingEngine):
    try:
        return ToolpathOperation(tool=engine.tool, paths=engine.process())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/pocket/closed", response_model=ToolpathOperation)
async def pocket_closed(engine: ClosedPocketingEngine):
    try:
        return ToolpathOperation(tool=engine.tool, paths=engine.process())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
