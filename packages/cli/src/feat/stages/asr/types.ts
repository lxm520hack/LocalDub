import { Context } from "@repo/core/context/context";

export interface AsrOptions {
	ctx: Context;
	taskId: string;
	audioPath: string;
	sessionPath: string;
	language?: string;
	device: string;
	pythonBin: string;
}

export type AsrResult = {
	audio_info: {
		duration: number; // 视频总时长，单位 ms
	};
	result: {
		text: string; // 完整转录文本
		segments: {
			text: string; // 该段文本
			start: number; // 该段开始时间，单位 s
			end: number; // 该段结束时间，单位 s
			words?: [];
		}[];
	};
	_device: string; // 运行设备，如 "cuda"、"cpu" 等
	detected_language?: string; // 可选的检测到的语言代码，如 "en"、"zh" 等
};