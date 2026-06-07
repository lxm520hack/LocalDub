import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { readEnginesConfig, REPO_ROOT, pythonBin } from '../config/engines.ts';
import type { TTSEngineConfig } from '../config/types.ts';
import { MLDaemon } from '../../ml/daemon/client.ts';
import { VoxCPMNodeONNX, VoxCPMCloud, VoxCPMPython, writeWav } from '@repo/voxlab';
import { readTaskLanguages, emitLog, nowISO, updateStageDB } from './utils.ts';

function createTTSBackend(cfg: TTSEngineConfig) {
  if (cfg.runtime === 'cloud') return new VoxCPMCloud();
  if (cfg.runtime === 'pytorch') return new VoxCPMPython();
  const device = cfg.device === 'webgpu' ? 'webgpu' : 'cpu';
  return new VoxCPMNodeONNX({ executionProvider: device });
}

async function runPytorchBatch(
  taskId: string,
  ttsCfg: TTSEngineConfig,
  translationFile: string,
  vocalsDir: string,
  ttsDir: string,
  total: number,
) {
  const scriptPath = join(REPO_ROOT, 'packages', 'voxlab', 'scripts', 'voxcpm_infer_batch.py');
  const modelDir = join(REPO_ROOT, 'data', 'modelscope', 'OpenBMB__VoxCPM2');
  const pyBin = pythonBin();
  const voxcpmSrc = join(REPO_ROOT, 'submodule', 'VoxCPM', 'src');

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(pyBin, [
      scriptPath,
      '--model-dir', modelDir,
      '--translation-file', translationFile,
      '--vocals-dir', vocalsDir,
      '--tts-dir', ttsDir,
      '--device', ttsCfg.device,
    ], {
      env: { ...process.env, PYTHONPATH: voxcpmSrc },
    });

    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        const progressMatch = line.match(/^\[PROGRESS\] (\d+)\/(\d+)$/);
        if (progressMatch) {
          const current = parseInt(progressMatch[1]);
          const ttl = parseInt(progressMatch[2]);
          updateStageDB(taskId, 'tts', { last_message: `Generating ${current}/${ttl}...` });
        } else if (line.startsWith('{')) {
          try {
            const result = JSON.parse(line);
            emitLog(taskId, `[TTS] Batch complete: ${result.generated} generated, ${result.skipped} skipped, ${result.errors} errors in ${result.total_time_s}s`);
            if (result.generate_time_s) {
              emitLog(taskId, `[VoxCPM] Generated in ${result.total_time_s}s | RTF ${result.rtf}`);
            }
          } catch { /* not JSON */ }
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        const errMsg = stderr.slice(-500);
        reject(new Error(`Python batch TTS exit code ${code}: ${errMsg}`));
        return;
      }
      resolve();
    });

    proc.on('error', reject);
  });
}

export async function stageTts(taskId: string, sessionPath: string, daemon?: MLDaemon) {
  const engines = readEnginesConfig();
  const { targetLanguage: dstLangCode } = readTaskLanguages(sessionPath);
  const translationFile = resolve(REPO_ROOT, sessionPath, 'metadata', `translation.${dstLangCode}.json`);
  const vocalsDir = resolve(REPO_ROOT, sessionPath, 'segments', 'vocals');
  const ttsDir = resolve(REPO_ROOT, sessionPath, 'segments', 'tts');

  if (!existsSync(translationFile)) throw new Error(`${translationFile} not found`);
  mkdirSync(ttsDir, { recursive: true });

  const data = JSON.parse(readFileSync(translationFile, 'utf-8'));
  const translation = data.translation;

  const anyTts = readdirSync(ttsDir).find(f => f.endsWith('.wav'));
  if (anyTts && statSync(translationFile).mtimeMs > statSync(join(ttsDir, anyTts)).mtimeMs) {
    for (const f of readdirSync(ttsDir)) rmSync(join(ttsDir, f));
    const sessionAbs = resolve(REPO_ROOT, sessionPath);
    const dubbingFile = join(sessionAbs, 'tmp', 'audio_dubbing.wav');
    const timingsFile = join(sessionAbs, 'metadata', 'timings.json');
    const finalVideo = join(sessionAbs, 'media', 'video_final.mp4');
    for (const f of [dubbingFile, timingsFile, finalVideo]) { if (existsSync(f)) rmSync(f); }
  }

  const ttsCfg = engines.tts;

  if (ttsCfg.runtime === 'pytorch' && daemon?.ready) {
    emitLog(taskId, `[TTS] Using Python daemon (device=${ttsCfg.device})`);
    const modelDir = join(REPO_ROOT, 'data', 'modelscope', 'OpenBMB__VoxCPM2');
    const result = await daemon.runStage('tts', taskId, {
      translation_file: translationFile,
      vocals_dir: vocalsDir,
      tts_dir: ttsDir,
      model_dir: modelDir,
      device: ttsCfg.device,
    }, (current, total) => {
      emitLog(taskId, `[TTS] ${current}/${total}`);
      updateStageDB(taskId, 'tts', { last_message: `Generating ${current}/${total}...` });
    });
    const r = result as Record<string, number>;
    emitLog(taskId, `[TTS] Batch complete: ${r.generated ?? 0} generated, ${r.skipped ?? 0} skipped, ${r.errors ?? 0} errors`);
    if (r.load_time_s) emitLog(taskId, `[TTS] Model loaded in ${r.load_time_s}s`);
    if (r.generate_time_s) emitLog(taskId, `[TTS] Generated in ${r.generate_time_s}s`);
    if (r.total_time_s) emitLog(taskId, `[TTS] Total ${r.total_time_s}s (load + generate)`);
    if (r.errors && r.errors > 0) emitLog(taskId, `[WARN] [TTS] ${r.errors} segments had errors`);
    await updateStageDB(taskId, 'tts', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'TTS done' });
    return;
  }

  if (ttsCfg.runtime === 'pytorch') {
    await runPytorchBatch(taskId, ttsCfg, translationFile, vocalsDir, ttsDir, translation.length);
  } else {
    let fallbackRef = '';
    for (let i = 0; i < translation.length; i++) {
      const idx = String(i + 1).padStart(4, '0');
      const refPath = resolve(vocalsDir, `${idx}.wav`);
      if (existsSync(refPath) && statSync(refPath).size > 1200 * 16 * 2) {
        fallbackRef = refPath;
        break;
      }
    }

    const voxcpm = createTTSBackend(ttsCfg);
    await voxcpm.load();

    for (let i = 0; i < translation.length; i++) {
      const item = translation[i];
      const idx = String(i + 1).padStart(4, '0');
      const outPath = resolve(ttsDir, `${idx}.wav`);
      if (existsSync(outPath)) continue;

      const text = item.dst || item.zh || '';
      if (!text.trim()) {
        writeFileSync(outPath, Buffer.alloc(44));
        continue;
      }

      let refWav = resolve(vocalsDir, `${idx}.wav`);
      if (!existsSync(refWav) || statSync(refWav).size < 1200 * 16 * 2) {
        refWav = fallbackRef;
      }
      if (!refWav || !existsSync(refWav)) {
        emitLog(taskId, `[WARN] [TTS] No reference for segment ${idx}, skipping`);
        writeFileSync(outPath, Buffer.alloc(44));
        continue;
      }

      await updateStageDB(taskId, 'tts', { last_message: `Generating ${i + 1}/${translation.length}...` });

      const { samples: audio } = await voxcpm.generate({ text, referenceWavPath: refWav, promptText: item.src });
      writeWav(audio, outPath, 48000);
    }

    await voxcpm.dispose();
  }

  await updateStageDB(taskId, 'tts', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'TTS done' });
}
