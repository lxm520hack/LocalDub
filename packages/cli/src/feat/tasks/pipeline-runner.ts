import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { to } from '@repo/shared/lib/utils/try.ts';
// import { eq, sql } from 'drizzle-orm';
import { getStages } from './../../feat/tasks/stages.ts';
// import { taskStages, tasks } from './../../feat/tasks/table.ts';
import { readInputArgs } from '../input/input.ts';
import { STAGE_HANDLERS } from '../stages/index.ts';
import { Context, 	readCtx,
	readPipeline,
	readTask,
	setCtx,
	setStage,
	setTask,
	writeCtx,
    writeStages,  listStage,
    _writeCtx, } from '../context/context.ts';
import {
	emitLog,
	getStageStatuses,
	nowISO,
	// updateStageDB,
	// updateTaskDB,
} from '../stages/utils/utils.ts';


function snapshotConfig(sessionPath: string) {
	const args = readInputArgs();

	const snap: NonNullable<Context['input']> = {
		...args,
		timestamp: new Date().toISOString(),
		pipeline: args.task.pipeline ?? 'dub',
	};

	setCtx(sessionPath, { input: snap });
}

export async function runPipeline(ctx: Context) {
	const taskId= ctx.task.id
	const sessionPath = ctx.task.session_path
	let task = readTask(sessionPath);
	mkdirSync(sessionPath, { recursive: true });

	const pipeline = readPipeline(sessionPath);
	const stages = getStages(pipeline);
	const targetStage = ctx.input?.targetStage;
	if (targetStage && !stages.find((s) => s === targetStage)) {
		emitLog(sessionPath, `[WARN] targetStage "${targetStage}" 不在 ${pipeline} pipeline 中，忽略`);
	}

	snapshotConfig(sessionPath);

	await setTask(sessionPath, { status: 'running', started_at: nowISO() });

	for (const stage of stages) {
		const handler = STAGE_HANDLERS[stage];
		if (!handler) {
			emitLog(
				sessionPath,
				`[WARN] [Pipeline] No handler for stage ${stage}, skipping`,
			);
			continue;
		}

		await setStage(sessionPath, stage, {
			status: 'running',
			started_at: nowISO(),
			last_message: `Starting ${stage}...`,
		});
		setTask(sessionPath, { status: 'running', current_stage: stage, started_at: nowISO(),  });
		try {
			await handler(sessionPath);
			if (targetStage && stage === targetStage) {
				emitLog(sessionPath, `[Pipeline] 达到目标步骤 "${targetStage}"，停止`);
				break;
			}
		} catch (err: any) {
			const msg = err.message ?? String(err);
			emitLog(sessionPath, `[ERROR] [Pipeline] Stage ${stage} failed: ${msg}`);
			await setStage(sessionPath, stage, {
				status: 'failed',
				error_message: msg,
				completed_at: nowISO(),
			});
			await setTask(sessionPath, { status: 'failed', error_message: msg });
			throw err;
		}

		const next = readTask(sessionPath)
		if (next) {
			task = next;
		}
	}

	setTask(sessionPath, {
		status: 'succeeded',
		completed_at: nowISO(),
		current_stage: null,
	});
	emitLog(sessionPath, `[Pipeline] Task ${taskId} completed`);
}

export async function resumePipeline(
	ctx: Context,
) {
	const sessionPath = ctx.task.session_path
	const resumeFrom = ctx.input?.task?.resumeFrom
	ctx.task.current_stage = 'resumePipeline'
	setTask(ctx.task.session_path, { current_stage: 'resumePipeline' });
	const taskId= ctx.task.id
	let task = readTask(sessionPath);
	// Mode transition handling
	const lastRunMode = ctx.lastRunPipeline;
	if (lastRunMode && lastRunMode !== ctx.pipeline) {
		ctx.lastRunPipeline = ctx.pipeline;
		emitLog(
			sessionPath,
			`[Pipeline] switched from "${lastRunMode}" to "${ctx.pipeline}"`,
		);

		const stages = getStages(ctx.pipeline);
		const existing = listStage(sessionPath);
		const existingNames = new Set(existing.map((r) => r.name));
		const newStages = stages.filter((s) => !existingNames.has(s));
		if (newStages.length > 0) {

			writeStages(sessionPath,
				newStages.map((s) => ({
					task_id: taskId,
					name: s,
					label: s,
					status: 'pending',
				})),
			);
		}
		// merge_video produces different output per pipeline → force re-run
		setStage(sessionPath, 'merge_video', {
							status: 'pending',
				started_at: null,
				completed_at: null,
				error_message: null,
				progress: 0,
		})

	}

	_writeCtx(ctx);

	snapshotConfig(sessionPath);

	const pipeline = ctx.pipeline || 'dub';
	const stages = getStages(pipeline);

	let startIdx = 0;

	if (resumeFrom) {
		startIdx = stages.findIndex((s) => s === resumeFrom);
		if (startIdx === -1) throw new Error(`Unknown stage "${resumeFrom}"`);
		for (let i = startIdx; i < stages.length; i++) {
			setStage(sessionPath, stages[i], {
				status: 'pending',
				started_at: null,
				completed_at: null,
				error_message: null,
				progress: 0,
			});
		}
		emitLog(
			sessionPath,
			`[Pipeline] Resetting from "${resumeFrom}" (${stages.length - startIdx} stage(s)), resuming...`,
		);
	} else {
		const rows = listStage(sessionPath);
		const stageStatus = new Map(rows.map((r) => [r.name, r.status]));

		for (let i = 0; i < stages.length; i++) {
			if (stageStatus.get(stages[i]) !== 'succeeded') {
				startIdx = i;
				break;
			}
		}

		if (startIdx === 0) {
			emitLog(sessionPath, `[Pipeline] Resuming from beginning`);
		} else {
			emitLog(
				sessionPath,
				`[Pipeline] Skipping ${startIdx} completed stage(s), resuming from "${stages[startIdx]}"`,
			);
		}
	}

	const resumeTargetStage = ctx.input?.task?.targetStage;
	if (resumeTargetStage && !stages.find((s) => s === resumeTargetStage)) {
		emitLog(sessionPath, `[WARN] targetStage "${resumeTargetStage}" 不在 ${pipeline} pipeline 中，忽略`);
	}

	// 计算出目标步骤的索引
	const targetIdx = resumeTargetStage ? stages.findIndex((s) => s === resumeTargetStage) : -1;
	// 计算出 要运行的 stage 列表
	const runStages = targetIdx >= 0 ? stages.slice(startIdx, targetIdx + 1) : stages.slice(startIdx);
	console.log(`[Pipeline] Running runStages:` , runStages);
	for (let i = startIdx; i < stages.length; i++) {
		const stage = stages[i];
		const handler = STAGE_HANDLERS[stage];
		if (!handler) {
			emitLog(
				sessionPath,
				`[WARN] [Pipeline] No handler for stage ${stage}, skipping`,
			);
			continue;
		}

		setStage(sessionPath, stage, {
			status: 'running',
			started_at: nowISO(),
			last_message: `Starting ${stage}...`,
		});
		setTask(sessionPath, { status: 'running', current_stage: stage, started_at: nowISO(),  });
		try {
			await handler(sessionPath);
			if (resumeTargetStage && stage === resumeTargetStage) {
				emitLog(sessionPath, `[Pipeline] 达到目标步骤 "${resumeTargetStage}"，停止`);
				break;
			}
		} catch (err: any) {
			const msg = err.message ?? String(err);
			emitLog(sessionPath, `[ERROR] [Pipeline] Stage ${stage} failed: ${msg}`);
			setStage(sessionPath, stage, {
				status: 'failed',
				error_message: msg,
				completed_at: nowISO(),
			});
			await setTask(sessionPath, { status: 'failed', error_message: msg });
			throw err;
		}

		const next = readTask(sessionPath)
		if (next) {
			task = next;
		}
	}

	setTask(sessionPath, {
		status: 'succeeded',
		completed_at: nowISO(),
		current_stage: null,
	});
	emitLog(sessionPath, `[Pipeline] Task ${taskId} completed`);
}

export async function rerunSingleStage(
	ctx: Context,
) {
	const taskId= ctx.task.id
	const sessionPath = ctx.task.session_path
	const task = readTask(sessionPath)
	const stageName = ctx.input?.task.stageName
	const pipeline = readPipeline(sessionPath);
	const stages = getStages(pipeline);

	const stage = stages.find((s) => s === stageName);
	if (!stage) throw new Error(`Unknown stage "${stageName}"`);

	const handler = STAGE_HANDLERS[stage];
	if (!handler) throw new Error(`No handler for stage "${stageName}"`);

	snapshotConfig(sessionPath);

	setStage(sessionPath, stage, {
		status: 'running',
		completed_at: null,
		error_message: null,
		started_at: nowISO(),
		progress: 0,
		last_message: `Rerunning ${stage}...`,
	});
	setTask(sessionPath, { status: 'running', current_stage: stage, started_at: nowISO(),  });
	try {
		await handler(sessionPath);
	} catch (err: any) {
		const msg = err.message ?? String(err);
		emitLog(sessionPath, `[ERROR] [Pipeline] Stage ${stageName} failed: ${msg}`);
		await setStage(sessionPath, stage, {
			status: 'failed',
			error_message: msg,
			completed_at: nowISO(),
		});
		await setTask(sessionPath, { status: 'failed', error_message: msg });
		throw err;
	}

	await setStage(sessionPath, stage, {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
		last_message: `${stage} completed`,
	});
	emitLog(sessionPath, `[Pipeline] Stage ${stageName} completed`);
}
