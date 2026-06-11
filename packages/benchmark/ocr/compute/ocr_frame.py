import sys, json, os, time
from rapidocr_onnxruntime import RapidOCR

engine = RapidOCR()

def ocr_frame(
	image_path: str,
	bottom_only: bool = True,
	text_score: float | None = None,
	subtitle_only: bool = False,
) -> tuple[list, float]:
	if not os.path.isfile(image_path):
		raise FileNotFoundError(image_path)

	import cv2
	img = cv2.imread(image_path)
	if img is None:
		raise ValueError(f"Could not read image: {image_path}")

	h, w = img.shape[:2]

	if bottom_only:
		y_offset = int(h * 0.6)
		roi = img[y_offset:, :]
	else:
		y_offset = 0
		roi = img

	if subtitle_only and text_score is None:
		text_score = 0.3

	kwargs = {}
	if text_score is not None:
		kwargs["text_score"] = text_score
	t0 = time.perf_counter()
	result, elapse = engine(roi, **kwargs)
	inference_ms = (time.perf_counter() - t0) * 1000
	if not result:
		return [], inference_ms

	lines = []
	for box, text, confidence in result:
		if text.strip():
			conf = float(confidence) if isinstance(confidence, (int, float, str)) else 0.0
			adj_box = [[round(pt[0], 1), round(pt[1] + y_offset, 1)] for pt in box]
			y_center = (adj_box[0][1] + adj_box[2][1]) / 2
			if subtitle_only and not (620 <= y_center <= 700):
				continue
			lines.append({
				"text": text.strip(),
				"confidence": round(conf, 4),
				"box": adj_box,
			})
	return lines, inference_ms


if __name__ == "__main__":
	if len(sys.argv) < 2:
		print(json.dumps({"error": "Usage: python ocr_frame.py <image_path> [--full-frame] [--text-score <float>] [--subtitle-only]"}))
		sys.exit(1)

	image_path = sys.argv[1]
	bottom_only = "--full-frame" not in sys.argv
	text_score = None
	subtitle_only = "--subtitle-only" in sys.argv
	if "--text-score" in sys.argv:
		idx = sys.argv.index("--text-score")
		if idx + 1 < len(sys.argv):
			text_score = float(sys.argv[idx + 1])
	try:
		lines, inference_ms = ocr_frame(image_path, bottom_only=bottom_only, text_score=text_score, subtitle_only=subtitle_only)
		print(json.dumps({"lines": lines, "inference_ms": round(inference_ms, 2)}, ensure_ascii=False))
	except Exception as e:
		print(json.dumps({"error": str(e)}, ensure_ascii=False))
		sys.exit(1)
