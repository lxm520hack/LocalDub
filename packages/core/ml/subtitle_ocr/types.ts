

export interface FrameResult {
	text: string;
	timestamp: number;
	confidence: number;
	bbox?: { left: number; top: number; right: number; bottom: number };
	lines?: { text: string; confidence: number; box: number[][]; bbox: { left: number; top: number; right: number; bottom: number } }[];
}

export interface Segment {
	text: string;
	start: number;
	end: number;
	start_fmt?: string;
	end_fmt?: string;
	box_y?: [number, number];
	confidence?: number;
	frameCount?: number;
}

export interface SegmentWithAdjusted extends Segment {
	adjustedConfidence?: number;
	yPenalty?: number;
	isoPenalty?: number;
}