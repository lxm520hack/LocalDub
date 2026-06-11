import sys, json, struct, os
import numpy as np
import cv2

def postprocess_det(
	heatmap_raw: bytes,
	heatmap_H: int,
	heatmap_W: int,
	orig_height: int,
	orig_width: int,
	thresh: float = 0.3,
	box_thresh: float = 0.7,
	unclip_ratio: float = 2.0,
	max_candidates: int = 1000,
):
	data = np.frombuffer(heatmap_raw, dtype=np.float32).reshape(1, 1, heatmap_H, heatmap_W)
	pred = data[0, 0, :, :]  # (H, W)

	# Threshold
	bitmap = (pred > thresh).astype(np.uint8)

	# Find contours
	contours, _ = cv2.findContours((bitmap * 255).astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
	num_contours = min(len(contours), max_candidates)

	boxes = []
	scores = []
	for idx in range(num_contours):
		contour = contours[idx]
		# Get min area rect
		rect = cv2.minAreaRect(contour)
		pts = cv2.boxPoints(rect)
		sside = min(rect[1])
		if sside < 3:
			continue

		# Score (box_score_fast)
		xmin = int(np.clip(np.floor(pts[:, 0].min()), 0, heatmap_W - 1))
		xmax = int(np.clip(np.ceil(pts[:, 0].max()), 0, heatmap_W - 1))
		ymin = int(np.clip(np.floor(pts[:, 1].min()), 0, heatmap_H - 1))
		ymax = int(np.clip(np.ceil(pts[:, 1].max()), 0, heatmap_H - 1))
		mask = np.zeros((ymax - ymin + 1, xmax - xmin + 1), dtype=np.uint8)
		box_shifted = pts.copy()
		box_shifted[:, 0] -= xmin
		box_shifted[:, 1] -= ymin
		cv2.fillPoly(mask, [box_shifted.astype(np.int32)], 1)
		score = float(cv2.mean(pred[ymin:ymax + 1, xmin:xmax + 1], mask)[0])

		if score < box_thresh:
			continue

		# Unclip
		from shapely.geometry import Polygon
		import pyclipper
		poly = Polygon(pts)
		distance = poly.area * unclip_ratio / poly.length if poly.length > 0 else 0
		offset = pyclipper.PyclipperOffset()
		offset.AddPath(pts.tolist(), pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
		expanded = np.array(offset.Execute(distance))
		if len(expanded) == 0:
			continue
		expanded = expanded.reshape(-1, 2).astype(np.float32)

		# Get min area rect of expanded
		rect2 = cv2.minAreaRect(expanded)
		pts2 = cv2.boxPoints(rect2)
		sside2 = min(rect2[1])
		if sside2 < 5:
			continue

		# Scale to original image coordinates
		pts2[:, 0] = np.clip(np.round(pts2[:, 0] / heatmap_W * orig_width), 0, orig_width)
		pts2[:, 1] = np.clip(np.round(pts2[:, 1] / heatmap_H * orig_height), 0, orig_height)

		boxes.append(pts2.astype(np.int32).tolist())
		scores.append(score)

	return boxes, scores


if __name__ == "__main__":
	if len(sys.argv) < 7:
		print(json.dumps({"error": "Usage: python postprocess_det.py <heatmap.raw> <heatmap_H> <heatmap_W> <orig_H> <orig_W> [thresh] [box_thresh] [unclip_ratio]"}))
		sys.exit(1)

	heatmap_path = sys.argv[1]
	heatmap_H = int(sys.argv[2])
	heatmap_W = int(sys.argv[3])
	orig_H = int(sys.argv[4])
	orig_W = int(sys.argv[5])
	thresh = float(sys.argv[6]) if len(sys.argv) > 6 else 0.3
	box_thresh = float(sys.argv[7]) if len(sys.argv) > 7 else 0.7
	unclip_ratio = float(sys.argv[8]) if len(sys.argv) > 8 else 2.0

	with open(heatmap_path, 'rb') as f:
		heatmap_raw = f.read()

	boxes, scores = postprocess_det(heatmap_raw, heatmap_H, heatmap_W, orig_H, orig_W, thresh, box_thresh, unclip_ratio)
	result = [{"box": b, "score": s} for b, s in zip(boxes, scores)]
	print(json.dumps({"boxes": result, "count": len(result)}, ensure_ascii=False))
