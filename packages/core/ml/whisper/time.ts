import { emitLog } from "@repo/core/stages/utils/utils";

export function emitAsrTiming(sessionPath: string, asr: Record<string, any>, elapsedSec: number) {
	emitLog(sessionPath, `[ASR] Transcribed in ${elapsedSec.toFixed(1)}s`);
	const durationMs = asr.audio_info?.duration ?? 0;
	if (durationMs > 0) {
		const audioDurationS = durationMs / 1000;
		emitLog(sessionPath, `[ASR] Audio duration ${audioDurationS.toFixed(1)}s`);
		emitLog(sessionPath, `[ASR] RTF ${(elapsedSec / audioDurationS).toFixed(2)}`);
	}
}