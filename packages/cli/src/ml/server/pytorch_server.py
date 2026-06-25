"""
Torch server — FastAPI + uvicorn HTTP server.

Endpoints:
  GET  /                           → status dashboard (Solid.js + TailwindCSS)
  GET  /api/health                 → server status and model states
  GET  /api/logs                   → server log lines (text/plain lines)
  POST /api/run/{stage}            → execute a stage, returns SSE stream
  POST /api/shutdown               → graceful shutdown

SSE events from /api/run/{stage}:
  event: progress
  data: {"current":50,"total":100}

  event: complete
  data: {"output":{...}}

  event: error
  data: {"message":"..."}

Usage (detached, spawned by TS):
  .venv/bin/python packages/cli/src/ml/server/pytorch_server.py --http-port 19109

Check health:
  curl http://127.0.0.1:19109/api/health
"""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import os
import sys
import time
import traceback
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

# ---------------------------------------------------------------------------
# Server log buffer
# ---------------------------------------------------------------------------

class _LogBuffer:
    def __init__(self, max_lines: int = 500):
        self._lines: deque[str] = deque(maxlen=max_lines)

    def write(self, text: str) -> None:
        for line in text.rstrip("\n").split("\n"):
            if line:
                self._lines.append(line)

    def flush(self) -> None:
        pass

    def get_lines(self, n: int = 100) -> list[str]:
        return list(self._lines)[-n:]

    def get_text(self, n: int = 100) -> str:
        return "\n".join(self.get_lines(n))

_log_buffer = _LogBuffer()
_log_writer = _LogBuffer()

# Wrap stdout/stderr so all server-side output is captured
class _Tee:
    def __init__(self, stream, buffer: _LogBuffer):
        self._stream = stream
        self._buffer = buffer

    def write(self, text: str) -> None:
        self._stream.write(text)
        self._buffer.write(text)

    def flush(self) -> None:
        self._stream.flush()

    def reconfigure(self, **kwargs):
        if hasattr(self._stream, 'reconfigure'):
            self._stream.reconfigure(**kwargs)

    def isatty(self):
        return False

    @property
    def encoding(self):
        return getattr(self._stream, 'encoding', 'utf-8')

sys.stdout = _Tee(sys.stdout, _log_buffer)
sys.stderr = _Tee(sys.stderr, _log_buffer)

# ---------------------------------------------------------------------------
# Model handler imports
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(REPO_ROOT / "packages" / "cli" / "src" / "ml" / "demucs"))
sys.path.insert(0, str(REPO_ROOT / "packages" / "cli" / "src" / "ml" / "whisper"))
sys.path.insert(0, str(REPO_ROOT / "packages" / "cli" / "src" / "ml" / "voxcpm"))

from torch_server_separate import handle_separate  # noqa: PLC0414,E402
from torch_server_asr import handle_asr  # noqa: PLC0414,E402
from torch_server_tts import handle_tts  # noqa: PLC0414,E402

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="ML Torch Server")
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
# API endpoints (define BEFORE static files to avoid mount conflict)
# ---------------------------------------------------------------------------


@app.get("/api/logs")
async def get_logs(n: int = 100):
    return {"lines": "\n".join(_log_buffer.get_lines(n))}


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "uptime_s": round(time.time() - _start_time, 1),
        "models": _models,
    }


@app.post("/api/run/{stage}")
async def run_stage(stage: str, body: dict):
    task_id = body.get("task_id", "")
    params = body.get("params", {})
    return StreamingResponse(
        _run_stage_events(stage, task_id, params),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/shutdown")
async def shutdown():
    global _shutdown
    _shutdown = True
    # Schedule server shutdown in next event loop iteration
    asyncio.get_event_loop().call_later(0.1, lambda: __import__("os")._exit(0))
    return {"status": "shutting_down"}


# ---------------------------------------------------------------------------
# Static dashboard (Solid.js built output) — mounted last so API routes win
# ---------------------------------------------------------------------------

_DASHBOARD_DIR = REPO_ROOT / "packages" / "web" / "dist"
if _DASHBOARD_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(_DASHBOARD_DIR), html=True), name="dashboard")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="ML Torch Server (HTTP)")
    parser.add_argument(
        "--http-port", type=int, default=19109, help="HTTP port (default: 19109)"
    )
    parser.add_argument(
        "--host", type=str, default="127.0.0.1", help="Bind address (default: 127.0.0.1)"
    )
    args = parser.parse_args()

    print(
        f"[TorchServer] Starting HTTP server on {args.host}:{args.http_port}",
        flush=True,
    )
    uvicorn.run(app, host=args.host, port=args.http_port, log_level="info")


if __name__ == "__main__":
    main()
