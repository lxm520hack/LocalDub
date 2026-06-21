"""
Ensure VoxCPM model is cached locally — try ModelScope first, then HuggingFace.
Exit codes:
  0 = model ready (downloaded or already cached)
  1 = all download sources failed

Usage:
  python ensure_voxcpm.py <model_id> <local_dir>
"""

import os
import sys
from pathlib import Path


def _try_modelscope(model_id: str, local_dir: str) -> bool:
    try:
        from modelscope import snapshot_download
        snapshot_download(model_id, local_dir=local_dir)
        return True
    except Exception as exc:
        print(f"[ensure_voxcpm] ModelScope failed: {exc}", file=sys.stderr)
        return False


def _try_huggingface(model_id: str, local_dir: str) -> bool:
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(model_id.replace("__", "/"), local_dir=local_dir)
        return True
    except Exception as exc:
        print(f"[ensure_voxcpm] HuggingFace failed: {exc}", file=sys.stderr)
        return False


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: ensure_voxcpm.py <model_id> <local_dir>", file=sys.stderr)
        sys.exit(1)

    model_id = sys.argv[1]
    local_dir = os.path.abspath(sys.argv[2])
    cached = Path(local_dir)

    if cached.is_dir() and any(cached.iterdir()):
        print(f"[ensure_voxcpm] Model already cached at {local_dir}")
        sys.exit(0)

    print(f"[ensure_voxcpm] Downloading {model_id} to {local_dir}...")
    os.makedirs(local_dir, exist_ok=True)

    if _try_modelscope(model_id, local_dir):
        sys.exit(0)

    hf_model_id = model_id.replace("__", "/")
    if _try_huggingface(hf_model_id, local_dir):
        sys.exit(0)

    print(f"[ensure_voxcpm] Failed to download {model_id} from any source", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
