"""Batch VoxCPM PyTorch inference — loads model once, generates all segments.

Usage:
    python voxcpm_infer_batch.py \
        --model-dir PATH \
        --translation-file PATH \
        --vocals-dir PATH \
        --tts-dir PATH \
        --device cuda [--cfg-value 2.0] [--inference-timesteps 10]

Outputs [PROGRESS] lines to stdout for each segment.
Final summary JSON on last line.
Errors to stderr, continues on per-segment failure.
"""

import argparse
import json
import os
import sys
import time
import wave
import numpy as np


def _resolve_device(requested: str) -> str:
    device = requested.lower().strip()
    if device in ("gpu", "auto"):
        return "cuda"
    if device in ("cpu", "cuda", "mps"):
        return device
    return "cuda"


def write_wav(wav: np.ndarray, path: str, sample_rate: int = 48000):
    wav_int16 = np.clip(wav * 32767, -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(wav_int16.tobytes())


def write_empty_wav(path: str):
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(48000)
        wf.writeframes(b"")


def find_fallback_ref(vocals_dir: str, min_ms: int = 1200) -> str:
    files = sorted(os.listdir(vocals_dir))
    min_bytes = min_ms * 16 * 2  # 16-bit, 48000 Hz, mono = 96000 bytes/sec * 1.2
    for name in files:
        if not name.endswith(".wav"):
            continue
        path = os.path.join(vocals_dir, name)
        if os.path.getsize(path) >= min_bytes:
            return path
    # fallback to first wav
    for name in files:
        if name.endswith(".wav"):
            return os.path.join(vocals_dir, name)
    return ""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--translation-file", required=True)
    parser.add_argument("--vocals-dir", required=True)
    parser.add_argument("--tts-dir", required=True)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--cfg-value", type=float, default=2.0)
    parser.add_argument("--inference-timesteps", type=int, default=10)
    args = parser.parse_args()

    os.makedirs(args.tts_dir, exist_ok=True)

    t0 = time.perf_counter()

    device = _resolve_device(args.device)

    from voxcpm import VoxCPM

    model = VoxCPM.from_pretrained(
        args.model_dir,
        load_denoiser=False,
        device=device,
    )
    load_time = time.perf_counter() - t0

    with open(args.translation_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    items = data["translation"]
    total = len(items)
    if total == 0:
        print(json.dumps({"load_time_s": round(load_time, 3), "total_time_s": 0, "generated": 0, "skipped": 0, "errors": 0, "rtf": 0}))
        return

    fallback = find_fallback_ref(args.vocals_dir)

    gen_time = 0.0
    generated = 0
    skipped = 0
    errors = 0
    sample_rate = 48000

    for index, item in enumerate(items, start=1):
        idx = f"{index:04d}"
        out_path = os.path.join(args.tts_dir, f"{idx}.wav")

        if os.path.exists(out_path):
            skipped += 1
            print(f"[PROGRESS] {index}/{total}")
            sys.stdout.flush()
            continue

        text = item.get("dst") or item.get("zh", "")
        if not text.strip():
            write_empty_wav(out_path)
            skipped += 1
            print(f"[PROGRESS] {index}/{total}")
            sys.stdout.flush()
            continue

        ref_path = os.path.join(args.vocals_dir, f"{idx}.wav")
        ref_bytes = 1200 * 16 * 2
        if not os.path.exists(ref_path) or os.path.getsize(ref_path) < ref_bytes:
            ref_path = fallback
        if not ref_path or not os.path.exists(ref_path):
            write_empty_wav(out_path)
            print(f"[WARN] No reference for segment {idx}", file=sys.stderr)
            skipped += 1
            print(f"[PROGRESS] {index}/{total}")
            sys.stdout.flush()
            continue

        t1 = time.perf_counter()
        try:
            wav = model.generate(
                text=text,
                reference_wav_path=ref_path,
                cfg_value=args.cfg_value,
                inference_timesteps=args.inference_timesteps,
            )
            write_wav(wav, out_path, sample_rate)
            gen_time += time.perf_counter() - t1
            generated += 1
        except Exception as e:
            errors += 1
            print(f"[ERROR] Segment {idx} failed: {e}", file=sys.stderr)
            write_empty_wav(out_path)

        print(f"[PROGRESS] {index}/{total}")
        sys.stdout.flush()

    total_time = time.perf_counter() - t0
    out_dur = generated * 0  # placeholder — we don't track per-segment duration in batch
    rtf = round(gen_time / max(out_dur, 0.001), 3) if generated > 0 else 0

    result = {
        "load_time_s": round(load_time, 3),
        "generate_time_s": round(gen_time, 3),
        "total_time_s": round(total_time, 3),
        "generated": generated,
        "skipped": skipped,
        "errors": errors,
        "rtf": rtf,
    }
    print(json.dumps(result))

    if errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
