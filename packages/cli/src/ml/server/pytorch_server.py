"""
Pipeline daemon — FastAPI + uvicorn HTTP server.

Endpoints:
  GET  /health                       → daemon status and model states
  POST /run/{stage}                  → execute a stage, returns SSE stream
  POST /shutdown                     → graceful shutdown

SSE events from /run/{stage}:
  event: progress
  data: {"current":50,"total":100}

  event: complete
  data: {"output":{...}}

  event: error
  data: {"message":"..."}

Usage (detached, spawned by TS):
  .venv/bin/python packages/cli/src/ml/server/pytorch_server.py --http-port 19109

Check health:
  curl http://127.0.0.1:19109/health
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

# ---------------------------------------------------------------------------
# Model handler imports
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(REPO_ROOT / "packages" / "cli" / "src" / "ml" / "demucs"))
sys.path.insert(0, str(REPO_ROOT / "packages" / "cli" / "src" / "ml" / "whisper"))
sys.path.insert(0, str(REPO_ROOT / "packages" / "cli" / "src" / "ml" / "voxcpm"))

from daemon_separate import handle_separate  # noqa: PLC0414,E402
from daemon_asr import handle_asr  # noqa: PLC0414,E402
from daemon_tts import handle_tts  # noqa: PLC0414,E402

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="ML Pipeline Daemon")
_shutdown = False
_start_time = time.time()
_executor = ThreadPoolExecutor(max_workers=1)

# Track which models have been loaded
_models: dict[str, bool] = {"asr": False, "tts": False, "separate": False}


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------

def _emit_to_queue(queue: asyncio.Queue, obj: dict) -> None:
    """Wrap an emit-style dict into an SSE event and push to the queue."""
    event_type = obj.get("type", "message")
    data = {k: v for k, v in obj.items() if k != "type"}
    queue.put_nowait({"event": event_type, "data": data})


async def _run_stage_events(stage: str, task_id: str, params: dict):
    """Async generator yielding SSE events for a stage run."""
    queue: asyncio.Queue = asyncio.Queue()

    def emit(obj: dict) -> None:
        _emit_to_queue(queue, obj)

    def worker() -> None:
        try:
            if stage == "asr":
                _models["asr"] = True
                output = handle_asr(params)
                emit({"type": "complete", "output": output})
            elif stage == "tts":
                _models["tts"] = True
                output = handle_tts(params, task_id, emit=emit)
                emit({"type": "complete", "output": output})
            elif stage == "separate":
                _models["separate"] = True
                output = handle_separate(params, task_id, emit=emit)
                emit({"type": "complete", "output": output})
            else:
                emit({"type": "error", "message": f"Unknown stage: {stage}"})
        except Exception:
            traceback.print_exc(file=sys.stderr)
            sys.stderr.flush()
            emit({"type": "error", "message": traceback.format_exc()})

    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, worker)

    while True:
        event = await queue.get()
        yield f"event: {event['event']}\ndata: {json.dumps(event['data'], ensure_ascii=False)}\n\n"
        if event["event"] in ("complete", "error"):
            break


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "uptime_s": round(time.time() - _start_time, 1),
        "models": _models,
    }


@app.post("/run/{stage}")
async def run_stage(stage: str, body: dict):
    task_id = body.get("task_id", "")
    params = body.get("params", {})
    return StreamingResponse(
        _run_stage_events(stage, task_id, params),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/shutdown")
async def shutdown():
    global _shutdown
    _shutdown = True
    # Schedule server shutdown in next event loop iteration
    asyncio.get_event_loop().call_later(0.1, lambda: __import__("os")._exit(0))
    return {"status": "shutting_down"}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="ML Pipeline Daemon (HTTP)")
    parser.add_argument(
        "--http-port", type=int, default=19109, help="HTTP port (default: 19109)"
    )
    parser.add_argument(
        "--host", type=str, default="127.0.0.1", help="Bind address (default: 127.0.0.1)"
    )
    args = parser.parse_args()

    print(
        f"[Daemon] Starting HTTP server on {args.host}:{args.http_port}",
        flush=True,
    )
    uvicorn.run(app, host=args.host, port=args.http_port, log_level="info")


if __name__ == "__main__":
    main()
