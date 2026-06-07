import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Demucs } from './../../ml/demucs/demucs.ts';
import { readEnginesConfig, REPO_ROOT, pythonBin } from '../config/engines.ts';
import { MLDaemon } from '../../ml/daemon/client.ts';
import { nowISO, updateStageDB, ffmpeg, emitLog } from './utils.ts';

export async function stageSeparate(taskId: string, sessionPath: string, daemon?: MLDaemon) {
  await updateStageDB(taskId, 'separate', { last_message: 'Separating audio...', progress: 0 });

  const videoPath = join(sessionPath, 'media', 'video_source.mp4');
  if (!existsSync(videoPath)) throw new Error('video_source.mp4 not found');

  const engines = readEnginesConfig();
  const { runtime, device } = engines.separate;

  if (runtime === 'pytorch' && daemon?.ready) {
    emitLog(taskId, `[Separate] Using Python daemon (device=${device})`);
    const absSession = resolve(REPO_ROOT, sessionPath);
    const absVideo = resolve(REPO_ROOT, sessionPath, 'media', 'video_source.mp4');
    const result = await daemon.runStage('separate', taskId, {
      video_path: absVideo,
      session_path: absSession,
      device,
    }, (current, _total) => {
      emitLog(taskId, `[Separate] ${current}%`);
      updateStageDB(taskId, 'separate', { progress: current, last_message: `Separating ${current}%...` });
    });
    const sr = result as Record<string, number>;
    if (sr.load_time_s) emitLog(taskId, `[Separate] Model loaded in ${sr.load_time_s}s`);
    if (sr.process_time_s) emitLog(taskId, `[Separate] Processed in ${sr.process_time_s}s`);
    if (sr.audio_duration_s) emitLog(taskId, `[Separate] Audio duration ${sr.audio_duration_s.toFixed(1)}s`);
    if (sr.rtf) emitLog(taskId, `[Separate] RTF ${sr.rtf}`);
  } else if (runtime === 'pytorch') {
    await separatePytorch(taskId, sessionPath, videoPath, device);
  } else {
    await separateOrt(taskId, sessionPath, videoPath, device);
  }

  await updateStageDB(taskId, 'separate', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'Separated' });
}

async function separateOrt(taskId: string, sessionPath: string, videoPath: string, device: string) {
  const ep = device === 'webgpu' ? 'webgpu' : 'cpu';
  emitLog(taskId, `[Separate] runtime=ort device=${device} → ONNX session(${ep})`);

  const demucs = new Demucs(undefined, { executionProvider: ep });
  await demucs.load();

  const audioPath = join(sessionPath, 'tmp', 'audio_source.wav');
  mkdirSync(dirname(audioPath), { recursive: true });
  ffmpeg(['-i', videoPath, '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', audioPath]);

  const stems = await demucs.separate(audioPath);

  const mediaDir = join(sessionPath, 'media');
  demucs.writeWav(stems.vocals, stems.sampleRate, join(mediaDir, 'audio_vocals.wav'));

  const bgm = new Float32Array(stems.drums.length);
  for (let i = 0; i < bgm.length; i++) {
    bgm[i] = stems.drums[i] + stems.bass[i] + stems.other[i];
  }
  demucs.writeWav(bgm, stems.sampleRate, join(mediaDir, 'audio_bgm.wav'));
}

async function separatePytorch(taskId: string, sessionPath: string, videoPath: string, device: string) {
  const scriptPath = join(REPO_ROOT, 'packages', 'cli', 'scripts', 'separate', 'run.py');
  const pyBin = pythonBin();
  const pythonArgs = [scriptPath, videoPath, resolve(REPO_ROOT, sessionPath), '--device', device];

  emitLog(taskId, `[Separate] runtime=pytorch device=${device}`);

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(pyBin, pythonArgs);

    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        const m = line.match(/^\[PROGRESS\] (\d+)$/);
        if (m) {
          updateStageDB(taskId, 'separate', { progress: parseInt(m[1]), last_message: `Separating ${m[1]}%` });
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Demucs Python exit code ${code}: ${stderr.slice(-500)}`));
        return;
      }
      resolve();
    });

    proc.on('error', reject);
  });
}
