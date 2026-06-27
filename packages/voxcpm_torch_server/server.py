"""
Standalone Gradio server for local VoxCPM TTS.
Matches the /generate endpoint signature of voxcpm.modelbest.cn.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import numpy as np

_VOXCPM: "VoxCPM | None" = None
_VOXCPM_LOAD_TIME: float = 0.0

REPO_ROOT = Path(__file__).resolve().parents[2]


def load_model(model_dir: str, device: str) -> None:
    global _VOXCPM, _VOXCPM_LOAD_TIME
    if _VOXCPM is not None:
        return

    voxcpm_src = REPO_ROOT / "submodule" / "VoxCPM" / "src"
    if str(voxcpm_src) not in sys.path:
        sys.path.insert(0, str(voxcpm_src))

    if not os.path.isdir(model_dir) or not os.listdir(model_dir):
        sys.stderr.write(f"[VoxCPM] Model not found at {model_dir}, attempting download...\n")
        sys.stderr.flush()
        try:
            from modelscope import snapshot_download
            os.makedirs(model_dir, exist_ok=True)
            snapshot_download("OpenBMB/VoxCPM2", local_dir=model_dir)
            sys.stderr.write("[VoxCPM] Model downloaded via ModelScope\n")
        except Exception as exc:
            sys.stderr.write(f"[VoxCPM] ModelScope download failed ({exc}), trying HuggingFace\n")
        sys.stderr.flush()

    from voxcpm import VoxCPM
    t0 = time.perf_counter()
    _VOXCPM = VoxCPM.from_pretrained(model_dir, load_denoiser=False, device=device)
    _VOXCPM_LOAD_TIME = time.perf_counter() - t0
    sys.stderr.write(f"[VoxCPM] Model loaded ({_VOXCPM_LOAD_TIME:.1f}s, device={device})\n")
    sys.stderr.flush()


def generate(
    text: str,
    control_instruction: str = "",
    reference_audio: str | None = None,
    ultimate: bool = False,
    prompt_text: str = "",
    cfg_value: float = 2.0,
    normalize: bool = False,
    ref_denoise: bool = False,
    dit_steps: int = 10,
    _: str = "",
) -> tuple[int, np.ndarray]:
    """VoxCPM generate endpoint — same signature as voxcpm.modelbest.cn."""
    if _VOXCPM is None:
        raise RuntimeError("Model not loaded")

    # Only use reference_audio if it's a valid file path
    ref_path = None
    if reference_audio and isinstance(reference_audio, str) and os.path.isfile(reference_audio):
        ref_path = reference_audio

    wav = _VOXCPM.generate(
        text=text,
        reference_wav_path=ref_path,
        cfg_value=cfg_value,
        inference_timesteps=dit_steps,
        max_len=None,
    )

    return 48000, wav.astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser(description="Local VoxCPM Gradio server")
    parser.add_argument("--port", type=int, default=19112, help="Server port")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Bind address")
    parser.add_argument("--device", type=str, default="cpu", help="Device (cpu, cuda)")
    parser.add_argument(
        "--model-dir",
        type=str,
        default=str(REPO_ROOT / "data" / "modelscope" / "OpenBMB__VoxCPM2"),
        help="VoxCPM model directory",
    )
    args = parser.parse_args()

    # Pre-load model before starting server
    sys.stderr.write(f"[VoxCPM] Loading model from {args.model_dir} on {args.device}...\n")
    sys.stderr.flush()
    load_model(args.model_dir, args.device)

    import gradio as gr

    server_port = args.port
    server_host = args.host

    # Try to find a free port if the default is occupied
    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((server_host, server_port))
        sock.close()
    except OSError:
        server_port = 0  # let Gradio pick a free port
    finally:
        sock.close()

    iface = gr.Interface(
        fn=generate,
        inputs=[
            gr.Textbox(label="text", placeholder="Input text"),
            gr.Textbox(label="control_instruction", value=""),
            gr.Audio(type="filepath", label="reference_audio"),
            gr.Checkbox(label="ultimate", value=False),
            gr.Textbox(label="prompt_text", value=""),
            gr.Slider(0, 5, value=2.0, step=0.1, label="cfg_value"),
            gr.Checkbox(label="normalize", value=False),
            gr.Checkbox(label="ref_denoise", value=False),
            gr.Number(value=10, label="dit_steps", precision=0),
            gr.Textbox(value="", visible=False),
        ],
        outputs=gr.Audio(type="numpy", label="Generated Audio"),
        title="VoxCPM Local",
        description=f"Local VoxCPM TTS (device={args.device})",
    )

    print(f"[VoxCPM] Starting Gradio server on {server_host}:{server_port}", flush=True)
    iface.launch(server_name=server_host, server_port=server_port)


if __name__ == "__main__":
    main()
