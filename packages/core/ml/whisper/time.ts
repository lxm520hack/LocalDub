import { emitLog } from "@repo/core/stages/utils/utils";

export function emitAsrTiming(taskDir: string, asr: Record<string, any>, elapsedSec: number) {
	emitLog(taskDir, `[ASR] Transcribed in ${elapsedSec.toFixed(1)}s`);
	const durationMs = asr.audio_info?.duration ?? 0;
	if (durationMs > 0) {
		const audioDurationS = durationMs / 1000;
		emitLog(taskDir, `[ASR] Audio duration ${audioDurationS.toFixed(1)}s`);
		emitLog(taskDir, `[ASR] RTF ${(elapsedSec / audioDurationS).toFixed(2)}`);
	}
}