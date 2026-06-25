"""
Torch server handler for VoxCPM TTS stage.
Imported by pytorch_server.py.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Callable

import numpy as np
import wave

_VOXCPM: "VoxCPM | None" = None

def _load_voxcpm(model_dir: str, device: str) -> None:
    global _VOXCPM
    if _VOXCPM is not None:
        return

    if not os.path.isdir(model_dir) or not os.listdir(model_dir):
        sys.stderr.write(f"[TTS] Model not found at {model_dir}, attempting download...\n")
        sys.stderr.flush()
        try:
            from modelscope import snapshot_download
            os.makedirs(model_dir, exist_ok=True)
            snapshot_download("OpenBMB/VoxCPM2", local_dir=model_dir)
            sys.stderr.write("[TTS] Model downloaded via ModelScope\n")
        except Exception as exc:
            sys.stderr.write(f"[TTS] ModelScope download failed ({exc}), trying HuggingFace\n")
        sys.stderr.flush()

    from voxcpm import VoxCPM
    _VOXCPM = VoxCPM.from_pretrained(model_dir, load_denoiser=False, device=device)


def _write_wav(wav, path: str, sample_rate: int = 48000) -> None:
    wav_int16 = np.clip(wav * 32767, -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(wav_int16.tobytes())


def _write_empty_wav(path: str) -> None:
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(48000)
        wf.writeframes(b"")


def handle_tts(params: dict, task_id: str, *, emit: Callable | None = None) -> dict:
    translation_file = Path(params["translation_file"])
    vocals_dir = Path(params["vocals_dir"])
    tts_dir = Path(params["tts_dir"])
    model_dir = params["model_dir"]
    device = params.get("device", "cpu")
    cfg_value = float(params.get("cfg_value", 2.0))
    timesteps = int(params.get("inference_timesteps", 10))
    skip_existing = bool(params.get("skipExisting", False))

    tts_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    _load_voxcpm(model_dir, device)
    load_time = time.perf_counter() - t0

    data = json.loads(translation_file.read_text(encoding="utf-8"))
    items = data["translation"]
    total = len(items)
    if total == 0:
        return {"generated": 0, "skipped": 0, "errors": 0, "generate_time_s": 0, "load_time_s": round(load_time, 3)}

    min_bytes = 1200 * 16 * 2
    fallback = ""
    for f in sorted(vocals_dir.glob("*.wav")):
        if f.stat().st_size >= min_bytes:
            fallback = str(f)
            break

    generated = skipped = errors = 0
    gen_time = 0.0

    for index, item in enumerate(items, start=1):
        idx = f"{index:04d}"
        out_path = tts_dir / f"{idx}.wav"

        ref_path = vocals_dir / f"{idx}.wav"
        if not ref_path.exists() or ref_path.stat().st_size < min_bytes:
            ref_path = Path(fallback) if fallback else None
        ref_mtime = ref_path.stat().st_mtime_ns if ref_path and ref_path.exists() else 0

        if skip_existing and out_path.exists() and out_path.stat().st_mtime_ns > ref_mtime:
            skipped += 1
            if emit:
                emit({"type": "progress", "stage": "tts", "task_id": task_id, "current": index, "total": total})
            continue

        text = item.get("dst") or item.get("zh", "")
        if not text.strip():
            _write_empty_wav(str(out_path))
            skipped += 1
            if emit:
                emit({"type": "progress", "stage": "tts", "task_id": task_id, "current": index, "total": total})
            continue

        if ref_path is None or not ref_path.exists():
            _write_empty_wav(str(out_path))
            skipped += 1
            if emit:
                emit({"type": "progress", "stage": "tts", "task_id": task_id, "current": index, "total": total})
            continue

        t1 = time.perf_counter()
        try:
            wav = _VOXCPM.generate(
                text=text,
                reference_wav_path=str(ref_path),
                cfg_value=cfg_value,
                inference_timesteps=timesteps,
            )
            _write_wav(wav, str(out_path), 48000)
            gen_time += time.perf_counter() - t1
            generated += 1
        except Exception as e:
            errors += 1
            sys.stderr.write(f"[ERROR] Segment {idx} failed: {e}\n")
            sys.stderr.flush()
            _write_empty_wav(str(out_path))

        if emit:
            emit({"type": "progress", "stage": "tts", "task_id": task_id, "current": index, "total": total})

    total_time = time.perf_counter() - t0
    out_dur = sum(
        item.get("end_time", 0) - item.get("start_time", 0)
        for item in items
    ) / 1000.0
    rtf = round(gen_time / max(out_dur, 0.001), 3) if generated > 0 and out_dur > 0 else 0
    return {
        "generated": generated,
        "skipped": skipped,
        "errors": errors,
        "generate_time_s": round(gen_time, 3),
        "load_time_s": round(load_time, 3),
        "total_time_s": round(total_time, 3),
        "rtf": rtf,
    }
