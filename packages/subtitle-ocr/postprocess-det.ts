import { cv } from 'opencv-wasm';

interface Point {
	x: number;
	y: number;
}

/** Extract points from a 2-channel int32 contour Mat (from findContours) */
function contourToPoints(contour: any): Point[] {
	const pts: Point[] = [];
	const d = contour.data32S;
	const ch = contour.channels();
	const stride = contour.cols * ch;
	for (let i = 0; i < contour.rows; i++) {
		pts.push({ x: d[i * stride], y: d[i * stride + 1] });
	}
	return pts;
}

/** Sort 4 RotatedRect corner points to [tl, tr, br, bl] (Python get_mini_boxes order) */
function getMiniBoxes(rect: any): Point[] {
	const pts: Point[] = cv.rotatedRectPoints(rect);

	const idx = [0, 1, 2, 3].sort((a, b) => pts[a].x - pts[b].x);
	const leftIdx = [idx[0], idx[1]].sort((a, b) => pts[a].y - pts[b].y);
	const rightIdx = [idx[2], idx[3]].sort((a, b) => pts[a].y - pts[b].y);
	return [pts[leftIdx[0]], pts[rightIdx[0]], pts[rightIdx[1]], pts[leftIdx[1]]];
}

/** Vertex-normal polygon offset (ported from geometry.h) */
function offsetPolygon(poly: Point[], distance: number): Point[] {
	if (poly.length === 0) return [];
	const n = poly.length;

	let signedArea = 0;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		signedArea += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
	}
	const sign = signedArea >= 0 ? 1 : -1;

	const result: Point[] = [];
	for (let i = 0; i < n; i++) {
		const prev = (i - 1 + n) % n;
		const next = (i + 1) % n;

		const e1x = poly[i].x - poly[prev].x;
		const e1y = poly[i].y - poly[prev].y;
		const e2x = poly[next].x - poly[i].x;
		const e2y = poly[next].y - poly[i].y;

		const len1 = Math.hypot(e1x, e1y);
		const len2 = Math.hypot(e2x, e2y);
		if (len1 < 1e-6 || len2 < 1e-6) continue;

		const n1x = sign * e1y / len1;
		const n1y = -sign * e1x / len1;
		const n2x = sign * e2y / len2;
		const n2y = -sign * e2x / len2;

		let nx = n1x + n2x;
		let ny = n1y + n2y;
		let nlen = Math.hypot(nx, ny);
		if (nlen < 1e-6) {
			nx = n1x;
			ny = n1y;
			nlen = 1;
		}

		const scale = distance / nlen;
		result.push({ x: poly[i].x + nx * scale, y: poly[i].y + ny * scale });
	}

	return result;
}

/** Box score: fillPoly mask on local sub-region + mean */
function boxScore(prob: any, box: Point[]): number {
	const xmin = Math.max(0, Math.floor(Math.min(...box.map(p => p.x))));
	const xmax = Math.min(prob.cols - 1, Math.ceil(Math.max(...box.map(p => p.x))));
	const ymin = Math.max(0, Math.floor(Math.min(...box.map(p => p.y))));
	const ymax = Math.min(prob.rows - 1, Math.ceil(Math.max(...box.map(p => p.y))));
	const bw = xmax - xmin + 1, bh = ymax - ymin + 1;
	if (bw <= 0 || bh <= 0) return 0;

	const mask = cv.Mat.zeros(bh, bw, cv.CV_8U);
	const ptsMat = cv.matFromArray(4, 2, cv.CV_32S, [
		Math.round(box[0].x - xmin), Math.round(box[0].y - ymin),
		Math.round(box[1].x - xmin), Math.round(box[1].y - ymin),
		Math.round(box[2].x - xmin), Math.round(box[2].y - ymin),
		Math.round(box[3].x - xmin), Math.round(box[3].y - ymin),
	]);
	const contours = new cv.MatVector();
	contours.push_back(ptsMat);
	cv.fillPoly(mask, contours, new cv.Scalar(1));
	const subProb = prob.roi(new cv.Rect(xmin, ymin, bw, bh));
	const meanVal = cv.mean(subProb, mask);
	const score = meanVal[0];

	mask.delete();
	ptsMat.delete();
	contours.delete();
	subProb.delete();

	return score;
}

export interface DBResult {
	box: number[][];
	score: number;
}

export function dbPostprocess(
	heatmapBuf: ArrayBuffer | SharedArrayBuffer,
	H: number, W: number,
	origH: number, origW: number,
	thresh = 0.3,
	boxThresh = 0.5,
	unclipRatio = 1.6,
	maxCandidates = 1000,
	useNms = true,
): DBResult[] {
	const raw = new Float32Array(heatmapBuf as ArrayBuffer);
	const prob = new cv.Mat(H, W, cv.CV_32F);
	prob.data32F.set(raw);

	const bitmap = new cv.Mat();
	cv.threshold(prob, bitmap, thresh, 255, cv.THRESH_BINARY);
	bitmap.convertTo(bitmap, cv.CV_8U);

	const kernel = cv.Mat.ones(2, 2, cv.CV_8U);
	const dilated = new cv.Mat();
	cv.dilate(bitmap, dilated, kernel);
	kernel.delete();
	bitmap.delete();

	const contours = new cv.MatVector();
	const hierarchy = new cv.Mat();
	cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
	hierarchy.delete();
	dilated.delete();

	const results: { box: Point[]; score: number }[] = [];
	const num = Math.min(contours.size(), maxCandidates);

	for (let i = 0; i < num; i++) {
		const contour = contours.get(i);
		const pts = contourToPoints(contour);
		contour.delete();

		if (pts.length < 3) continue;

		const contourMat = cv.matFromArray(pts.length, 2, cv.CV_32F, pts.flatMap(p => [p.x, p.y]));
		const rect = cv.minAreaRect(contourMat);
		contourMat.delete();

		const ordered = getMiniBoxes(rect);

		const sideA = Math.hypot(ordered[0].x - ordered[1].x, ordered[0].y - ordered[1].y);
		const sideB = Math.hypot(ordered[1].x - ordered[2].x, ordered[1].y - ordered[2].y);
		if (Math.min(sideA, sideB) < 3) continue;

		const score = boxScore(prob, ordered);
		if (score < boxThresh) continue;

		let area = 0, len = 0;
		for (let k = 0; k < 4; k++) {
			const j = (k + 1) % 4;
			area += ordered[k].x * ordered[j].y - ordered[j].x * ordered[k].y;
			len += Math.hypot(ordered[j].x - ordered[k].x, ordered[j].y - ordered[k].y);
		}
		area = Math.abs(area) * 0.5;
		let dist = len > 0 ? area * unclipRatio / len : 0;
		dist = Math.max(3, dist);

		const expanded = offsetPolygon(ordered, dist);
		if (expanded.length < 4) continue;

		const expMat = cv.matFromArray(expanded.length, 2, cv.CV_32F, expanded.flatMap(p => [p.x, p.y]));
		const finalRect = cv.minAreaRect(expMat);
		expMat.delete();

		const finalPts = getMiniBoxes(finalRect);
		const side1 = Math.hypot(finalPts[0].x - finalPts[1].x, finalPts[0].y - finalPts[1].y);
		const side2 = Math.hypot(finalPts[1].x - finalPts[2].x, finalPts[1].y - finalPts[2].y);
		if (Math.min(side1, side2) < 5) continue;

		const scaleW = origW / W;
		const scaleH = origH / H;
		for (const p of finalPts) {
			p.x = Math.round(p.x * scaleW);
			p.y = Math.round(p.y * scaleH);
			p.x = Math.max(0, Math.min(origW - 1, p.x));
			p.y = Math.max(0, Math.min(origH - 1, p.y));
		}

		results.push({ box: finalPts, score });
	}

	contours.delete();
	prob.delete();

	if (useNms && results.length > 1) {
		const bboxes = results.map((r, idx) => {
			const xs = r.box.map(p => p.x);
			const ys = r.box.map(p => p.y);
			const xMin = Math.min(...xs), xMax = Math.max(...xs);
			const yMin = Math.min(...ys), yMax = Math.max(...ys);
			const area = Math.max(1, xMax - xMin) * Math.max(1, yMax - yMin);
			return { idx, xMin, yMin, xMax, yMax, area, score: r.score };
		});
		bboxes.sort((a, b) => b.area - a.area);
		const keep = new Array(results.length).fill(true);
		for (let i = 0; i < bboxes.length; i++) {
			if (!keep[bboxes[i].idx]) continue;
			for (let j = i + 1; j < bboxes.length; j++) {
				if (!keep[bboxes[j].idx]) continue;
				const iXMin = Math.max(bboxes[i].xMin, bboxes[j].xMin);
				const iYMin = Math.max(bboxes[i].yMin, bboxes[j].yMin);
				const iXMax = Math.min(bboxes[i].xMax, bboxes[j].xMax);
				const iYMax = Math.min(bboxes[i].yMax, bboxes[j].yMax);
				if (iXMax <= iXMin || iYMax <= iYMin) continue;
				const iArea = (iXMax - iXMin) * (iYMax - iYMin);
				if (iArea / bboxes[j].area > 0.7) keep[bboxes[j].idx] = false;
			}
		}
		const filtered = results.filter((_, i) => keep[i]);
		return filtered.map(r => ({
			box: r.box.map(p => [p.x, p.y]),
			score: r.score,
		}));
	}

	return results.map(r => ({
		box: r.box.map(p => [p.x, p.y]),
		score: r.score,
	}));
}
