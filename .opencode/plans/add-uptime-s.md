# Add `uptime_s` to `/status` responses

## Files to edit

### 1. `packages/torch_server/pytorch_server.py`

**Line 221** — add `uptime_s` to the `/status` response:

```python
return {
    "status": "running",
    "port": _SERVER_PORT,
    "uptime_s": int(time.time() - _start_time),   # <-- add this
    "models": {name: {"status": status} for name, status in _models.items()},
}
```

(`_start_time` already exists at line 133 — `_start_time = time.time()`)

### 2. `packages/voxcpm_torch_server/server.py`

**After line 18** — add `_START_TIME` at module level:

```python
_MODEL_STATUS: str = "unloaded"
_START_TIME: float = time.time()     # <-- add this
```

**Line 116** — add `uptime_s` to the `/status` response:

```python
return {
    "status": "running",
    "port": _PORT,
    "uptime_s": int(time.time() - _START_TIME),   # <-- add this
    "models": {"voxcpm": {"status": _MODEL_STATUS}},
}
```
