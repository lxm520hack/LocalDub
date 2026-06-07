"""
Pipeline daemon — keeps ML models (Whisper, VoxCPM, Demucs) loaded across video tasks.

Protocol (JSON lines on stdin/stdout):

  TS ──stdin──→ daemon:  {"action":"run_stage","stage":"asr","task_id":"...","params":{...}}
  daemon ──stdout──→ TS: {"type":"progress","stage":"asr","current":1,"total":10}
                          {"type":"complete","stage":"asr","output":{...}}
                          {"type":"error","stage":"asr","message":"..."}

Commands:
  run_stage  — execute a pipeline stage (asr | tts | separate)
  shutdown   — graceful exit

On startup, daemon sends {"type":"ready"} then enters stdin read loop.
Models are lazy-loaded on first use and cached as module-level singletons.

Usage (spawned by TS):
  PYTHONPATH=submodule/VoxCPM/src:$PYTHONPATH \\
    .venv/bin/python packages/cli/scripts/pipeline_daemon.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
import wave
from pathlib import Path

# Windows: ensure stdin/stdout use binary mode so JSON lines protocol
# (newline-delimited) is not corrupted by \n → \r\n translation.
if sys.platform == "win32":
    import msvcrt  # noqa: PLC0415
    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)   # type: ignore[attr-defined]
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)  # type: ignore[attr-defined]

# ---------------------------------------------------------------------------
# Model singletons
# ---------------------------------------------------------------------------

_WHISPER: "whisper.Whisper | None" = None
_VOXCPM: "VoxCPM | None" = None


def _load_whisper(device: str) -> None:
    global _WHISPER
    if _WHISPER is not None:
        return
    import whisper

    _WHISPER = whisper.load_model(
        os.getenv("WHISPER_MODEL", "large-v3-turbo"),
        device=device,
        download_root=os.getenv("WHISPER_DOWNLOAD_ROOT") or None,
    )


def _load_voxcpm(model_dir: str, device: str) -> None:
    global _VOXCPM
    if _VOXCPM is not None:
        return
    from voxcpm import VoxCPM

    _VOXCPM = VoxCPM.from_pretrained(model_dir, load_denoiser=False, device=device)


def _load_demucs(device: str):
    demucs_path = _demucs_source_path()
    sys.path.insert(0, str(demucs_path))
    from demucs.api import Separator

    return Separator

# ---------------------------------------------------------------------------
# Stage handlers
# ---------------------------------------------------------------------------

def _to_ms(seconds: float) -> int:
    return int(round(float(seconds) * 1000))


def _convert_words(words: list) -> list:
    return [
        {"text": w.get("word", ""), "start_time": _to_ms(w.get("start", 0.0)), "end_time": _to_ms(w.get("end", 0.0))}
        for w in words or []
    ]


def _convert_segments(segments: list) -> list:
    return [
        {"text": seg.get("text", "").strip(), "start_time": _to_ms(seg.get("start", 0.0)),
         "end_time": _to_ms(seg.get("end", 0.0)), "words": _convert_words(seg.get("words", []))}
        for seg in segments
    ]


def _write_wav(wav, path: str, sample_rate: int = 48000) -> None:
    import numpy as np

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


def _demucs_source_path() -> Path:
    repo_root = Path(__file__).resolve().parents[3]
    demucs_path = repo_root / "submodule" / "demucs"
    if (demucs_path / "demucs" / "api.py").exists():
        return demucs_path
    raise RuntimeError("Demucs submodule not found; run: git submodule update --init --recursive")


def _demucs_progress(info: dict, shifts: int) -> int:
    models = max(1, int(info.get("models") or 1))
    model_index = max(0, int(info.get("model_idx_in_bag") or 0))
    shift_index = max(0, int(info.get("shift_idx") or 0))
    audio_length = max(0, int(info.get("audio_length") or 0))
    segment_offset = max(0, int(info.get("segment_offset") or 0))
    segment_ratio = min(segment_offset / audio_length, 1) if audio_length else 0
    total_units = max(1, models * shifts)
    completed_units = model_index * shifts + shift_index + segment_ratio
    return max(0, min(99, int(completed_units / total_units * 100)))


# ---------------------------------------------------------------------------
# ASR (Whisper)
# ---------------------------------------------------------------------------

def handle_asr(params: dict) -> dict:
    from pydub import AudioSegment

    vocals_path = params["vocals_path"]
    session_path = params["session_path"]
    raw_language = params.get("language", "auto")
    language = None if raw_language == "auto" else raw_language
    device = params.get("device", "cpu")

    t0 = time.perf_counter()
    _load_whisper(device)
    load_time = time.perf_counter() - t0

    t1 = time.perf_counter()
    result = _WHISPER.transcribe(vocals_path, language=language, word_timestamps=False, verbose=False)
    process_time = time.perf_counter() - t1

    utterances = _convert_segments(result.get("segments", []))
    if not utterances:
        raise RuntimeError("Whisper did not return any segments.")

    duration_ms = len(AudioSegment.from_file(vocals_path))
    audio_duration_s = duration_ms / 1000.0
    payload = {
        "audio_info": {"duration": duration_ms},
        "result": {
            "text": (result.get("text") or "").strip(),
            "utterances": utterances,
        },
    }

    metadata_dir = Path(session_path) / "metadata"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    output_file = metadata_dir / "asr.json"
    output_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    detected = result.get("language", "")
    return {
        "asr_file": str(output_file),
        "detected_language": detected,
        "load_time_s": round(load_time, 3),
        "process_time_s": round(process_time, 3),
        "audio_duration_s": round(audio_duration_s, 3),
        "rtf": round(process_time / audio_duration_s, 3) if audio_duration_s > 0 else 0,
    }


# ---------------------------------------------------------------------------
# TTS (VoxCPM)
# ---------------------------------------------------------------------------

def handle_tts(params: dict, task_id: str) -> dict:
    translation_file = Path(params["translation_file"])
    vocals_dir = Path(params["vocals_dir"])
    tts_dir = Path(params["tts_dir"])
    model_dir = params["model_dir"]
    device = params.get("device", "cpu")
    cfg_value = float(params.get("cfg_value", 2.0))
    timesteps = int(params.get("inference_timesteps", 10))

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

        if out_path.exists():
            skipped += 1
            _emit_progress("tts", task_id, index, total)
            continue

        text = item.get("dst") or item.get("zh", "")
        if not text.strip():
            _write_empty_wav(str(out_path))
            skipped += 1
            _emit_progress("tts", task_id, index, total)
            continue

        ref_path = vocals_dir / f"{idx}.wav"
        if not ref_path.exists() or ref_path.stat().st_size < min_bytes:
            ref_path = Path(fallback) if fallback else None
        if ref_path is None or not ref_path.exists():
            _write_empty_wav(str(out_path))
            skipped += 1
            _emit_progress("tts", task_id, index, total)
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

        _emit_progress("tts", task_id, index, total)

    total_time = time.perf_counter() - t0
    return {
        "generated": generated,
        "skipped": skipped,
        "errors": errors,
        "generate_time_s": round(gen_time, 3),
        "load_time_s": round(load_time, 3),
        "total_time_s": round(total_time, 3),
    }


# ---------------------------------------------------------------------------
# Separate (Demucs)
# ---------------------------------------------------------------------------

def handle_separate(params: dict, task_id: str) -> dict:
    from pydub import AudioSegment

    video_path = params["video_path"]
    session_path = params["session_path"]
    device = params.get("device", "cpu")

    t0 = time.perf_counter()
    Separator = _load_demucs(device)

    media_dir = Path(session_path) / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    vocals_file = media_dir / "audio_vocals.wav"
    bgm_file = media_dir / "audio_bgm.wav"

    shifts = 3

    def report_progress(info: dict) -> None:
        progress = _demucs_progress(info, shifts)
        _emit_progress("separate", task_id, progress, 100)

    separator = Separator(
        model="htdemucs_ft",
        device=device,
        progress=True,
        shifts=shifts,
        callback=report_progress,
    )
    load_time = time.perf_counter() - t0

    t1 = time.perf_counter()
    _, separated = separator.separate_audio_file(video_path)
    process_time = time.perf_counter() - t1

    audio_duration_s = len(AudioSegment.from_file(video_path)) / 1000.0

    vocals = separated["vocals"]
    bgm = None
    for stem, source in separated.items():
        if stem == "vocals":
            continue
        bgm = source if bgm is None else bgm + source

    from demucs.api import save_audio

    save_audio(vocals, str(vocals_file), samplerate=separator.samplerate)
    save_audio(bgm, str(bgm_file), samplerate=separator.samplerate)

    return {
        "vocals_file": str(vocals_file),
        "bgm_file": str(bgm_file),
        "load_time_s": round(load_time, 3),
        "process_time_s": round(process_time, 3),
        "audio_duration_s": round(audio_duration_s, 3),
        "rtf": round(process_time / audio_duration_s, 3) if audio_duration_s > 0 else 0,
    }


# ---------------------------------------------------------------------------
# IO helpers
# ---------------------------------------------------------------------------

def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _emit_progress(stage: str, task_id: str, current: int, total: int) -> None:
    _emit({"type": "progress", "stage": stage, "task_id": task_id, "current": current, "total": total})


def _emit_complete(stage: str, task_id: str, output: dict) -> None:
    _emit({"type": "complete", "stage": stage, "task_id": task_id, "output": output})


def _emit_error(stage: str, task_id: str, message: str) -> None:
    _emit({"type": "error", "stage": stage, "task_id": task_id, "message": message})


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    _emit({"type": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            sys.stderr.write(f"Invalid JSON from stdin: {line}\n")
            sys.stderr.flush()
            continue

        action = cmd.get("action", "")
        if action == "shutdown":
            break

        if action == "run_stage":
            stage = cmd.get("stage", "")
            task_id = cmd.get("task_id", "")
            params = cmd.get("params", {})
            try:
                if stage == "asr":
                    output = handle_asr(params)
                elif stage == "tts":
                    output = handle_tts(params, task_id)
                elif stage == "separate":
                    output = handle_separate(params, task_id)
                else:
                    _emit_error(stage, task_id, f"Unknown stage: {stage}")
                    continue
                _emit_complete(stage, task_id, output)
            except Exception as e:
                tb = traceback.format_exc()
                sys.stderr.write(f"[{stage}] {tb}\n")
                sys.stderr.flush()
                _emit_error(stage, task_id, str(e))
        else:
            sys.stderr.write(f"Unknown action: {action}\n")
            sys.stderr.flush()

    _emit({"type": "shutdown"})


if __name__ == "__main__":
    main()
