#!/usr/bin/env python3
"""Minimal ONNX inference helper for subtitle-rust.

The Rust binary pipes raw f32 input tensor bytes on stdin and expects raw
f32 output tensor bytes on stdout. Command line:

    infer_onnx.py <det|cls|rec> <models_dir> <comma_separated_dims>

The models_dir must contain:
    ch_PP-OCRv3_det_infer.onnx
    ch_ppocr_mobile_v2.0_cls_infer.onnx
    ch_PP-OCRv3_rec_infer.onnx
"""

import sys
import os

import numpy as np
import onnxruntime as ort


MODELS = {
    "det": "ch_PP-OCRv3_det_infer.onnx",
    "cls": "ch_ppocr_mobile_v2.0_cls_infer.onnx",
    "rec": "ch_PP-OCRv3_rec_infer.onnx",
}


def main():
    if len(sys.argv) < 4:
        print("usage: infer_onnx.py <det|cls|rec> <models_dir> <dims_csv>",
              file=sys.stderr)
        sys.exit(2)
    kind, models_dir, dims_str = sys.argv[1], sys.argv[2], sys.argv[3]
    if kind not in MODELS:
        print(f"unknown kind {kind}", file=sys.stderr)
        sys.exit(2)

    dims = [int(d) for d in dims_str.split(",")]

    model_path = os.path.join(models_dir, MODELS[kind])
    sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])

    # Read raw bytes for one input tensor.
    raw = sys.stdin.buffer.read()
    arr = np.frombuffer(raw, dtype=np.float32).reshape(dims).copy()

    input_name = sess.get_inputs()[0].name
    outputs = sess.run(None, {input_name: arr})
    first = outputs[0].astype(np.float32).ravel()
    sys.stdout.buffer.write(first.tobytes())


if __name__ == "__main__":
    main()
