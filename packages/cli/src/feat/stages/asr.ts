import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, readEnginesConfig, pythonBin } from '../config/engines.ts';
import { MLDaemon } from '../../ml/daemon/client.ts';
import { readTaskLanguages, nowISO, updateStageDB, emitLog } from './utils.ts';

export async function stageAsr(taskId: string, sessionPath: string, daemon?: MLDaemon) {
  await updateStageDB(taskId, 'asr', { last_message: 'Transcribing...', progress: 0 });

  const vocalsPath = resolve(REPO_ROOT, sessionPath, 'media', 'audio_vocals.wav');
  const sessionAbsPath = resolve(REPO_ROOT, sessionPath);
  if (!existsSync(vocalsPath)) throw new Error('audio_vocals.wav not found');

  const engines = readEnginesConfig();
  const { runtime, device } = engines.asr;
  emitLog(taskId, `[ASR] runtime=${runtime} device=${device}`);

  const pyBin = pythonBin();
  const { asrLanguage } = readTaskLanguages(sessionPath);

  if (runtime === 'pytorch' && daemon?.ready) {
    emitLog(taskId, `[ASR] Using Python daemon (device=${device})`);
    const result = await daemon.runStage('asr', taskId, {
      vocals_path: vocalsPath,
      session_path: sessionAbsPath,
      language: asrLanguage || 'auto',
      device,
    });
    const r = result as Record<string, any>;
    if (r.detected_language) {
      const localInfoPath = join(sessionAbsPath, 'metadata', 'local_info.json');
      let local: any = {};
      try { local = JSON.parse(readFileSync(localInfoPath, 'utf-8')); } catch {}
      local.asr_language = r.detected_language;
      writeFileSync(localInfoPath, JSON.stringify(local, null, 2));
    }
    if (r.load_time_s) emitLog(taskId, `[ASR] Model loaded in ${r.load_time_s}s`);
    if (r.process_time_s) emitLog(taskId, `[ASR] Transcribed in ${r.process_time_s}s`);
    if (r.audio_duration_s) emitLog(taskId, `[ASR] Audio duration ${Number(r.audio_duration_s).toFixed(1)}s`);
    if (r.rtf) emitLog(taskId, `[ASR] RTF ${r.rtf}`);
  } else if (runtime === 'pytorch') {
    await asrPytorch(taskId, vocalsPath, sessionAbsPath, asrLanguage, device, pyBin);
  } else {
    await asrFasterWhisper(taskId, vocalsPath, sessionAbsPath, asrLanguage, device, pyBin);
  }

  await updateStageDB(taskId, 'asr', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'Transcribed' });
}

async function asrPytorch(taskId: string, vocalsPath: string, sessionAbsPath: string, language: string | undefined, device: string, pyBin: string) {
  const script = join(REPO_ROOT, 'packages', 'cli', 'scripts', 'asr', 'pytorch.py');
  const args = [script, vocalsPath, sessionAbsPath, language || 'auto', '--device', device];
  const result = spawnSync(pyBin, args, { maxBuffer: 256 * 1024 * 1024, timeout: 600_000 });

  if (result.error) throw new Error(`Python ASR subprocess failed: ${result.error.message}`);
  if (result.signal) throw new Error(`ASR killed by signal ${result.signal}: ${(result.stderr?.toString() || '').trim().slice(-200)}`);
  if (result.status !== 0) throw new Error(`Python ASR exited with status ${result.status}: ${result.stderr?.toString() || ''}`);

  const asrOutputPath = parseAsrOutput(result.stdout?.toString() || '');
  if (!asrOutputPath || !existsSync(asrOutputPath)) {
    throw new Error(`Python ASR did not produce output at ${asrOutputPath}`);
  }

  const asr = JSON.parse(readFileSync(asrOutputPath, 'utf-8'));
  if (asr.detected_language) {
    const localInfoPath = join(sessionAbsPath, 'metadata', 'local_info.json');
    let local: any = {};
    try { local = JSON.parse(readFileSync(localInfoPath, 'utf-8')); } catch { /* new file */ }
    local.asr_language = asr.detected_language;
    writeFileSync(localInfoPath, JSON.stringify(local, null, 2));
  }
}

function parseAsrOutput(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('ASR_OUTPUT:')) return trimmed.slice('ASR_OUTPUT:'.length).trim();
  }
  return stdout.trim() || null;
}

async function asrFasterWhisper(taskId: string, vocalsPath: string, sessionAbsPath: string, language: string | undefined, device: string, pyBin: string) {
  const asrScript = join(REPO_ROOT, 'packages', 'cli', 'scripts', 'asr', 'run.py');
  const baseArgs = [asrScript, vocalsPath, sessionAbsPath, language || 'auto'];

  const useGpu = device !== 'cpu';
  const attempts = useGpu ? 2 : 1;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const args = attempt === 0 && useGpu ? baseArgs : [...baseArgs, '--cpu'];
    const result = spawnSync(pyBin, args, {
      maxBuffer: 256 * 1024 * 1024,
      timeout: 600_000,
    });

    if (result.signal) {
      const stderr = (result.stderr?.toString() || '').trim().slice(-200);
      if (attempt === 0 && useGpu) {
        await updateStageDB(taskId, 'asr', { last_message: 'GPU hang, retrying CPU...' });
        continue;
      }
      throw new Error(`ASR killed by signal ${result.signal}: ${stderr}`);
    }

    if (result.error) throw new Error(`Python ASR subprocess failed: ${result.error.message}`);
    if (result.status !== 0) {
      const stderr = result.stderr?.toString() || '';
      throw new Error(`Python ASR exited with status ${result.status}: ${stderr}`);
    }

    const asrOutputPath = parseAsrOutput(result.stdout?.toString() || '');
    if (!asrOutputPath || !existsSync(asrOutputPath)) {
      throw new Error(`Python ASR did not produce output at ${asrOutputPath}`);
    }

    const asr = JSON.parse(readFileSync(asrOutputPath, 'utf-8'));
    if (asr.detected_language) {
      const localInfoPath = join(sessionAbsPath, 'metadata', 'local_info.json');
      let local: any = {};
      try { local = JSON.parse(readFileSync(localInfoPath, 'utf-8')); } catch { /* new file */ }
      local.asr_language = asr.detected_language;
      writeFileSync(localInfoPath, JSON.stringify(local, null, 2));
    }

    return;
  }
}
