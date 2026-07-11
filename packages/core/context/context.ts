import { CliInput, CliInputInput } from "../input/types";
import { readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { fileLog, getLastSegment } from '../utils/fileOps.ts';
import { TargetLang } from "@repo/core/cmd/tasks/input";

export const getTaskId = (taskDir: string) => getLastSegment(taskDir)

export type VideoSource = 'youtube' | 'bilibili' | 'local' | 'remote' | 'unknown';

export interface TaskBrief {
  id: string;
  title?: string | null
  status: string; // queued
  current_stage?: string | null
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
}

export interface Task extends TaskBrief {
  source: VideoSource
  url: string;
  task_dir: string
  final_video_path?: string | null | undefined;
}
export interface Context {
  task: Task;
  stages?: TaskStage[]
  pipeline: 'dub' | 'subtitle';
  lastRunPipeline?: 'dub' | 'subtitle'; // 用于 detect pipeline 切换
  input: CliInput
  runInfo?: {
		asr?: {
			engine: string; // 'whisper-pytorch' | 'faster-whisper'
			device: string;
			computeType?: string;
			gpuAttempted?: boolean;
			fallbackToCpu?: boolean;
		};
  }
	videoSourcePath?: string; //
	audioSourcePath?: string; // 
  asr_language?: string; // ASR 自动检测的语言
	target_language?: TargetLang; // translate 阶段写入的目标语言: 如果 config 中没有指定 targetLang 则按照这个逻辑: 源语言: zh -> en, 否则 any -> zh
}


export interface TaskStage {
  completed_at?: string | null | undefined;
  error_message?: string | null | undefined;
  label: string;
  last_message?: string | null | undefined;
  name: string;
  progress?: number | null | undefined;
  started_at?: string | null | undefined;
  status: string;
}

export const ctxPath = (taskDir: string) =>
	join(taskDir, 'ctx.json');

/**
 * readFileSync, JSON.parse 都可以抛错, 如何处理交给使用者
 */
export const readCtx = (taskDir: string) => {
	const path = ctxPath(taskDir);
	const raw = _readCtx(taskDir)
	console.log(`[File] read ${path}`);
	return raw 
};
export const _readCtx = (taskDir: string) => {
	const path = ctxPath(taskDir);
	const raw = JSON.parse(readFileSync(path, 'utf-8'));
	return raw as Context;
};
export const writeCtx = (ctx: Context) => {
	const path = ctxPath(ctx.task.task_dir);
	const raw = JSON.stringify(ctx, null, 2);
	writeFileSync(path, raw);
	const lines = raw.split('\n').length;
	_writeCtx(ctx);
	console.log(`[${ctx.task.current_stage}] [File] write ${path} (${raw.length}B, ${lines} lines)`);
	return ctx;
};
export const _writeCtx = (ctx: Context) => {
	const path = ctxPath(ctx.task.task_dir);
	const raw = JSON.stringify(ctx, null, 2);
	writeFileSync(path, raw);
	return ctx;
};
export const _setCtx = (
	taskDir: string,
	patch: Partial<Context>,
 ) => {
	const existing = _readCtx(taskDir) ?? ({} as Context);
	const ctx = _writeCtx( { ...existing, ...patch });
	return ctx;
};
export const setCtx = (
	taskDir: string,
	patch: Partial<Context>,
) => {
	const ctx = _setCtx(taskDir,patch)
	console.log(`[${ctx.task.current_stage}] setCtx ${ctxPath(taskDir)}:`, JSON.stringify(patch));
	return ctx;
};
export const readTask = (taskDir: string) => {
	const path = ctxPath(taskDir);
	const raw = readFileSync(path, 'utf-8');
	const ctx = JSON.parse(raw) as Context;
	return ctx.task;
}
export const _writeTask = ( task: Task) => {
	_setCtx(task.task_dir, { task });
}
export const writeTask = ( task: Task) => {
	_setCtx(task.task_dir, { task });
			console.log(`[${task.current_stage}] setTask ${ctxPath(task.task_dir)}:`, JSON.stringify(task));
}
export const setTask = (taskDir: string, patch: Partial<Task>) => {
	// If marking succeeded, clear any previous error_message to avoid stale failure state
	if (patch.status === 'succeeded') {
		patch.error_message = null;
	}
	const existing = readTask(taskDir) ?? ({} as Task);
	const updated = { ...existing, ...patch };
	_writeTask(updated);
	console.log(`[${updated.current_stage}] setTask:`, JSON.stringify(patch));
}

export const listStage = (taskDir: string) => _readCtx(taskDir).stages ?? [];
const readStage = (taskDir: string, stage: string) => {
	return listStage(taskDir).find((s) => s.name === stage)
}
export const writeStages = (taskDir: string, stages: TaskStage[]) => {
	const ctx = readCtx(taskDir);
	writeCtx({...ctx, stages});
}
const writeStage = (taskDir: string, stage: string, newStage: TaskStage) => {
	const ctx = _readCtx(taskDir);
	const stages = ctx.stages ?? [];
	const idx = stages.findIndex((s) => s.name === stage);
	if (idx !== -1) {
		stages[idx] = newStage;
	} else {
		stages.push(newStage);
	}
	_writeCtx(ctx);
}
export const setStage = (taskDir: string, stage: string, patch: Partial<TaskStage>) => {
	_readCtx(taskDir)
	const existing = readStage(taskDir, stage) ?? ({} as TaskStage);
	const updated = { ...existing, ...patch };
	if (updated.status === 'succeeded') updated.error_message = null as any;
	writeStage(taskDir, stage, updated);
	console.log(`[${_readCtx(taskDir).task.current_stage}] setStage: ${stage}`, JSON.stringify(patch));
}

export const readPipeline = (taskDir: string) =>
	readCtx(taskDir)?.pipeline || 'dub';
