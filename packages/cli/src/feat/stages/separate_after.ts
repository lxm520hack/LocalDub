import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { emitLog, ffmpeg, nowISO } from './utils/utils.ts';
import { Context, setStage } from '../context/context.ts';

export async function stageSeparateAfter(ctx: Context) {
	const sessionPath = ctx.task.session_path;
	const taskId = ctx.task.id;

	await setStage(sessionPath, 'separate_after', {
		last_message: 'Mixing BGM & sidechain...',
		progress: 0,
	});

	const mediaDir = join(sessionPath, 'media');
	const stems = {
		drums: join(mediaDir, 'target_0_drums.wav'),
		bass: join(mediaDir, 'target_1_bass.wav'),
		other: join(mediaDir, 'target_2_other.wav'),
		vocals: join(mediaDir, 'target_3_vocals.wav'),
	};
	const bgmDst = join(mediaDir, 'target_bgm.wav');
	const mixedDst = join(mediaDir, 'target_3_vocals_mixed.wav');

	// 1. Regenerate target_bgm.wav from stems (fixes amix normalize bug)
	const allStemsExist = [stems.drums, stems.bass, stems.other].every(existsSync);
	if (allStemsExist) {
		emitLog(sessionPath, `[SeparateAfter] Generating target_bgm.wav (amix normalize=0)...`);
		ffmpeg([
			'-i', stems.drums,
			'-i', stems.bass,
			'-i', stems.other,
			'-filter_complex', '[0:a][1:a][2:a]amix=inputs=3:duration=first:normalize=0[out];[out]dynaudnorm=peak=0.5[final]',
			'-map', '[final]',
			'-y', bgmDst,
		]);
	} else if (existsSync(bgmDst)) {
		emitLog(sessionPath, `[SeparateAfter] target_bgm.wav exists, reusing (stems not all found)`);
	} else {
		emitLog(sessionPath, `[SeparateAfter] No stems or BGM found, skipping BGM generation`);
	}

	// 2. Generate sidechain-mixed audio if configured
	const asrCfg = ctx.input?.stages?.asr;
	const useSeparated = asrCfg?.useSeparated ?? false;
	const mixMode = asrCfg?.mixMode ?? 'sidechain';
	const reduceBgm = asrCfg?.reduceBgm ?? -12;
	const sc = asrCfg?.sidechainCompress!;
	const useGate = asrCfg?.useGate ?? false;

	if (useSeparated && mixMode !== 'vocals') {
		const vocalsPath = stems.vocals;
		const bgmPath = bgmDst;
		if (!existsSync(vocalsPath)) {
			emitLog(sessionPath, `[SeparateAfter] vocals not found, skipping mix`);
		} else if (!existsSync(bgmPath)) {
			emitLog(sessionPath, `[SeparateAfter] BGM not found, skipping mix`);
		} else {
			if (mixMode === 'raw-sum') {
				emitLog(sessionPath, `[SeparateAfter] raw-sum: mixing vocals + BGM at ${reduceBgm}dB...`);
				ffmpeg([
					'-i', vocalsPath,
					'-i', bgmPath,
					'-filter_complex',
					`[1:a]volume=${reduceBgm}dB[bgm_r];[0:a][bgm_r]amix=inputs=2:duration=first:weights=1 1[out]`,
					'-map', '[out]',
					'-y', mixedDst,
				]);
			} else if (mixMode === 'sidechain') {
				const scParams = `threshold=${sc?.threshold ?? 0.1}:ratio=${sc?.ratio ?? 20}:attack=${sc?.attack ?? 1}:release=${sc?.release ?? 200}`;
				const bgmVol = reduceBgm !== 0 ? `[bgm_sc]volume=${reduceBgm}dB[bgm_final]` : null;
				emitLog(sessionPath, `[SeparateAfter] sidechain: ${scParams}, bgmReduce=${reduceBgm}dB`);
				ffmpeg([
					'-i', vocalsPath,
					'-i', bgmPath,
					'-filter_complex',
					`[0:a]asplit[v][v_key];[1:a][v_key]sidechaincompress=${scParams}[bgm_sc]${bgmVol ? `;${bgmVol}` : ''};[v][${bgmVol ? 'bgm_final' : 'bgm_sc'}]amix=inputs=2:duration=first:weights=1 1[out]`,
					'-map', '[out]',
					'-y', mixedDst,
				]);
			}
		}
	}

	if (useGate && existsSync(mixedDst)) {
		const gatedPath = join(mediaDir, 'target_3_vocals_gated.wav');
		emitLog(sessionPath, '[SeparateAfter] Applying silence gate...');
		ffmpeg([
			'-i', mixedDst,
			'-af', 'agate=threshold=0.02:ratio=20:attack=10:release=100',
			'-y', gatedPath,
		]);
	}

	await setStage(sessionPath, 'separate_after', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
		last_message: 'Done',
	});
}
