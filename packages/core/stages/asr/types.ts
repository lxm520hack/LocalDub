import { Context } from "@repo/core/context/context";

export interface AsrOptions {
	ctx: Context;
	taskId: string;
	audioPath: string;
	taskDir: string;
	language?: string;
	device: string;
	pythonBin: string;
}
type AsrWord = {
	word: string;
	start: number;
	end: number;
	probability: number;
}

export type AsrResult = {
	audio_info: {
		duration: number; // 视频总时长，单位 ms
	};
	result: {
		text: string; // 完整转录文本
		segments: {
			text: string; // 该段文本
			start: number; // 该段开始时间，单位 ms
			end: number; // 该段结束时间，单位 ms
			start_fmt?: string; // 可选的格式化开始时间，如 "00:01:23,456"
			end_fmt?: string; // 可选的格式化结束时间，如 "00:01:25,789"
			words?: AsrWord[];
			confidence: {
				avg: number; // 该段平均置信度，范围 [0, 1]
				min: number; // 该段最小置信度，范围 [0, 1]
			}
		}[];
	};
	_device: string; // 运行设备，如 "cuda"、"cpu" 等
	detected_language?: string; // 可选的检测到的语言代码，如 "en"、"zh" 等
};