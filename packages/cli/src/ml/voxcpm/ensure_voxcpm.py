"""
Ensure VoxCPM package and model are ready.
- Installs `voxcpm` Python package from submodule (if not importable)
- Downloads model weights via ModelScope / HuggingFace
Exit codes:
  0 = ready
  1 = failed

Usage:
  python ensure_voxcpm.py <model_id> <local_dir>
"""

import os
import subprocess
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
        snapshot_download(model_id, local_dir=local_dir)
        return True
    except Exception as exc:
        print(f"[ensure_voxcpm] HuggingFace failed: {exc}", file=sys.stderr)
        return False


def _ensure_package() -> bool:
    """Install voxcpm package from submodule if not already importable."""
    try:
        import voxcpm  # noqa: PLC0415
        print("[ensure_voxcpm] voxcpm package already installed")
        return True
    except ModuleNotFoundError:
        pass

    submodule_dir = Path(__file__).resolve().parents[6] / "submodule" / "VoxCPM"
    if not submodule_dir.is_dir():
        print(f"[ensure_voxcpm] Submodule not found at {submodule_dir}", file=sys.stderr)
        return False

    print(f"[ensure_voxcpm] Installing voxcpm from {submodule_dir}...")
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--no-build-isolation", "--no-deps", "-e", str(submodule_dir)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"[ensure_voxcpm] pip install failed: {result.stderr}", file=sys.stderr)
        return False
    print("[ensure_voxcpm] voxcpm package installed")
    return True


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: ensure_voxcpm.py <model_id> <local_dir>", file=sys.stderr)
        sys.exit(1)

    if not _ensure_package():
        sys.exit(1)

    model_id = sys.argv[1]
    local_dir = os.path.abspath(sys.argv[2])
    cached = Path(local_dir)

    # Check actual model weights exist, not just partial files
    if cached.is_dir():
        if (cached / "model.safetensors").exists() or (cached / "pytorch_model.bin").exists():
            print(f"[ensure_voxcpm] Model already cached at {local_dir}")
            sys.exit(0)
        partial_dirs = [cached / ".cache", cached / "._____temp"]
        for d in partial_dirs:
            if d.is_dir():
                import shutil
                shutil.rmtree(d)
                print(f"[ensure_voxcpm] Cleaned partial download: {d}")

    print(f"[ensure_voxcpm] Downloading {model_id} to {local_dir}...")
    os.makedirs(local_dir, exist_ok=True)

    if _try_modelscope(model_id, local_dir):
        sys.exit(0)

    if _try_huggingface(model_id, local_dir):
        sys.exit(0)

    print(f"[ensure_voxcpm] Failed to download {model_id} from any source", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
