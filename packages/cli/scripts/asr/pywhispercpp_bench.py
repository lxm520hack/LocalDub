"""
CLI ASR using pywhispercpp (whisper.cpp GGUF bindings).

Usage:
    .venv/bin/python packages/cli/scripts/asr/pywhispercpp.py <audio> <session_path> [language] [--model path/to/ggml-model.bin] [--n-threads 4]
    .venv/bin/python packages/cli/scripts/asr/pywhispercpp.py --benchmark-load [--model path/to/ggml-model.bin]

Model is auto-downloaded from HuggingFace to ~/.cache/pywhispercpp/ on first use.
Writes asr.json to <session_path>/metadata/asr.json
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def _to_ms(seconds: float) -> int:
    return int(round(float(seconds) * 1000))


def _parse_arg(name: str, default: str) -> str:
    if name in sys.argv:
        idx = sys.argv.index(name)
        if idx + 1 < len(sys.argv):
            return sys.argv[idx + 1]
    return default


def main() -> None:
    model_name = _parse_arg("--model", "large-v3-turbo")
    n_threads = int(_parse_arg("--n-threads", "4"))

    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    if "--benchmark-load" in sys.argv:
        from pywhispercpp.model import Model
        _ = Model(model_name, n_threads=n_threads)
        print("[BENCHMARK_LOAD_DONE]")
        return

    if len(args) < 2:
        print(f"Usage: {sys.argv[0]} <audio> <session_path> [language] [--model large-v3-turbo] [--n-threads 4]", file=sys.stderr)
        sys.exit(1)

    audio_file = Path(args[0])
    session_path = Path(args[1])
    language = None if args[2] == "auto" else args[2] if len(args) > 2 else None

    if not audio_file.is_file():
        print(f"Error: audio file not found: {audio_file}", file=sys.stderr)
        sys.exit(1)

    from pywhispercpp.model import Model

    model = Model(model_name, n_threads=n_threads, print_progress=False, print_realtime=False)
    segments = model.transcribe(str(audio_file))

    utterances = []
    for seg in segments:
        utterances.append({
            "text": (seg.text or "").strip(),
            "start_time": _to_ms(seg.t0),
            "end_time": _to_ms(seg.t1),
            "words": [],
        })
    full_text = " ".join(u["text"] for u in utterances).strip()

    metadata_dir = session_path / "metadata"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    output_file = metadata_dir / "asr.json"

    payload = {
        "audio_info": {"duration": _to_ms(max(s.t1 for s in segments)) if segments else 0},
        "result": {
            "text": full_text,
            "utterances": utterances,
        },
        "_device": "cpu",
    }
    output_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"ASR_OUTPUT:{output_file}")


if __name__ == "__main__":
    main()
