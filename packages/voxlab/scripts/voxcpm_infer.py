"""Standalone VoxCPM PyTorch inference — called as subprocess by voxlab.

Usage:
    python voxcpm_infer.py --model-dir PATH --ref WAV --text "你好世界" --output /tmp/out.wav

Prints JSON timing to stdout (single line).
"""

import argparse
import json
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--device", default="cuda")
    args = parser.parse_args()

    device = _resolve_device(args.device)

    t0 = time.perf_counter()

    # deferred import so --help is fast
    from voxcpm import VoxCPM

    model = VoxCPM.from_pretrained(
        args.model_dir,
        load_denoiser=False,
        device=device,
    )
    load_time = time.perf_counter() - t0

    t1 = time.perf_counter()
    wav = model.generate(
        text=args.text,
        reference_wav_path=args.ref,
        cfg_value=2.0,
    )
    gen_time = time.perf_counter() - t1

    # save as int16 WAV (48 kHz)
    wav_int16 = np.clip(wav * 32767, -32768, 32767).astype(np.int16)
    with wave.open(args.output, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(48000)
        wf.writeframes(wav_int16.tobytes())

    out_dur = len(wav) / 48000
    total_time = time.perf_counter() - t0

    result = {
        "load_time_s": round(load_time, 3),
        "generate_time_s": round(gen_time, 3),
        "total_time_s": round(total_time, 3),
        "output_samples": len(wav),
        "output_duration_s": round(out_dur, 3),
        "rtf": round(gen_time / out_dur, 3),
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
