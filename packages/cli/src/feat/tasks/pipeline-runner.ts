import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT, WORKFOLDER } from '@repo/config';
import { to } from '@repo/shared/lib/utils/try.ts';
import { eq, sql } from 'drizzle-orm';
import { db } from './../../db/index.ts';
import { getStages } from './../../feat/tasks/stages.ts';
import { taskStages, tasks } from './../../feat/tasks/table.ts';
import type { MLDaemon } from '../../ml/daemon/client.ts';
import {
	readLocalInfo,
	readPipeline,
	writeLocalInfo,
} from '../config/config.ts';
import { STAGE_HANDLERS } from '../stages/index.ts';
import {
	currentTask,
	emitLog,
	getStageStatuses,
	nowISO,
	updateStageDB,
	updateTaskDB,
} from '../stages/utils.ts';

export { getStageStatuses };

export async function runPipeline(taskId: string, daemon?: MLDaemon) {
	let { task, sessionPath } = await currentTask(taskId);
	mkdirSync(sessionPath, { recursive: true });

	const pipeline = readPipeline(sessionPath);
	const stages = getStages(pipeline);

	await updateTaskDB(taskId, { status: 'running', started_at: nowISO() });

	for (const stage of stages) {
		const handler = STAGE_HANDLERS[stage.name];
		if (!handler) {
			emitLog(
				taskId,
				`[WARN] [Pipeline] No handler for stage ${stage.name}, skipping`,
			);
			continue;
		}

		await updateStageDB(taskId, stage.name, {
			status: 'running',
			started_at: nowISO(),
			last_message: `Starting ${stage.label}...`,
		});
		await updateTaskDB(taskId, { current_stage: stage.name });

		try {
			await handler(taskId, sessionPath, task, daemon);
		} catch (err: any) {
			const msg = err.message ?? String(err);
			emitLog(taskId, `[ERROR] [Pipeline] Stage ${stage.name} failed: ${msg}`);
			await updateStageDB(taskId, stage.name, {
				status: 'failed',
				error_message: msg,
				completed_at: nowISO(),
			});
			await updateTaskDB(taskId, { status: 'failed', error_message: msg });
			return;
		}

		const next = await currentTask(taskId).catch(() => null);
		if (next) {
			task = next.task;
			sessionPath = next.sessionPath;
		}
	}

	await updateTaskDB(taskId, {
		status: 'succeeded',
		completed_at: nowISO(),
		current_stage: null,
	});
	emitLog(taskId, `[Pipeline] Task ${taskId} completed`);
}

export async function resumePipeline(
	taskId: string,
	resumeFrom?: string,
	stageOverrides?: Record<string, any>,
	daemon?: MLDaemon,
) {
	let { task, sessionPath } = await currentTask(taskId);

	const [info, err] = to(() => readLocalInfo(sessionPath));
	if (err) {
		throw new Error(`Failed to read local info: ${err.message}`);
	}
	// Mode transition handling
	const lastRunMode = info.lastRunPipeline;
	if (lastRunMode && lastRunMode !== info.pipeline) {
		info.lastRunPipeline = info.pipeline;
		emitLog(
			taskId,
			`[Pipeline] switched from "${lastRunMode}" to "${info.pipeline}"`,
		);

		const stages = getStages(info.pipeline);
		const existing = await db
			.select({ name: taskStages.name })
			.from(taskStages)
			.where(eq(taskStages.task_id, taskId));
		const existingNames = new Set(existing.map((r) => r.name));
		const newStages = stages.filter((s) => !existingNames.has(s.name));
		if (newStages.length > 0) {
			await db.insert(taskStages).values(
				newStages.map((s) => ({
					task_id: taskId,
					name: s.name,
					label: s.label,
					status: 'pending',
				})),
			);
		}

		// merge_video produces different output per pipeline → force re-run
		await db
			.update(taskStages)
			.set({
				status: 'pending',
				started_at: null,
				completed_at: null,
				error_message: null,
				progress: 0,
			})
			.where(
				sql`${taskStages.task_id} = ${taskId} AND ${taskStages.name} = 'merge_video'`,
			);
	}

	writeLocalInfo(sessionPath, info);

	const pipeline = info.pipeline || 'dub';
	const stages = getStages(pipeline);

	let startIdx = 0;

	if (resumeFrom) {
		startIdx = stages.findIndex((s) => s.name === resumeFrom);
		if (startIdx === -1) throw new Error(`Unknown stage "${resumeFrom}"`);
		for (let i = startIdx; i < stages.length; i++) {
			await updateStageDB(taskId, stages[i].name, {
				status: 'pending',
				started_at: null,
				completed_at: null,
				error_message: null,
				progress: 0,
			});
		}
		emitLog(
			taskId,
			`[Pipeline] Resetting from "${resumeFrom}" (${stages.length - startIdx} stage(s)), resuming...`,
		);
	} else {
		const rows = await db
			.select({ name: taskStages.name, status: taskStages.status })
			.from(taskStages)
			.where(eq(taskStages.task_id, taskId));
		const stageStatus = new Map(rows.map((r) => [r.name, r.status]));

		for (let i = 0; i < stages.length; i++) {
			if (stageStatus.get(stages[i].name) !== 'succeeded') {
				startIdx = i;
				break;
			}
		}

		if (startIdx === 0) {
			emitLog(taskId, `[Pipeline] Resuming from beginning`);
		} else {
			emitLog(
				taskId,
				`[Pipeline] Skipping ${startIdx} completed stage(s), resuming from "${stages[startIdx].name}"`,
			);
		}
	}

	await updateTaskDB(taskId, { status: 'running', started_at: nowISO() });

	for (let i = startIdx; i < stages.length; i++) {
		const stage = stages[i];
		const handler = STAGE_HANDLERS[stage.name];
		if (!handler) {
			emitLog(
				taskId,
				`[WARN] [Pipeline] No handler for stage ${stage.name}, skipping`,
			);
			continue;
		}

		await updateStageDB(taskId, stage.name, {
			status: 'running',
			started_at: nowISO(),
			last_message: `Starting ${stage.label}...`,
		});
		await updateTaskDB(taskId, { current_stage: stage.name });

		try {
			await handler(taskId, sessionPath, task, daemon);
		} catch (err: any) {
			const msg = err.message ?? String(err);
			emitLog(taskId, `[ERROR] [Pipeline] Stage ${stage.name} failed: ${msg}`);
			await updateStageDB(taskId, stage.name, {
				status: 'failed',
				error_message: msg,
				completed_at: nowISO(),
			});
			await updateTaskDB(taskId, { status: 'failed', error_message: msg });
			return;
		}

		const next = await currentTask(taskId).catch(() => null);
		if (next) {
			task = next.task;
			sessionPath = next.sessionPath;
		}
	}

	await updateTaskDB(taskId, {
		status: 'succeeded',
		completed_at: nowISO(),
		current_stage: null,
	});
	emitLog(taskId, `[Pipeline] Task ${taskId} completed`);
}

export async function rerunSingleStage(
	taskId: string,
	stageName: string,
	stageOverrides?: Record<string, any>,
	daemon?: MLDaemon,
) {
	const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
	if (!task) throw new Error(`Task ${taskId} not found`);

	const sessionPath = task.session_path
		? resolve(REPO_ROOT, task.session_path)
		: join(WORKFOLDER, taskId);

	const pipeline = readPipeline(sessionPath);
	const stages = getStages(pipeline);

	const stage = stages.find((s) => s.name === stageName);
	if (!stage) throw new Error(`Unknown stage "${stageName}"`);

	const handler = STAGE_HANDLERS[stageName];
	if (!handler) throw new Error(`No handler for stage "${stageName}"`);

	await updateStageDB(taskId, stageName, {
		status: 'pending',
		started_at: null,
		completed_at: null,
		error_message: null,
		progress: 0,
	});
	await updateStageDB(taskId, stageName, {
		status: 'running',
		started_at: nowISO(),
		last_message: `Rerunning ${stage.label}...`,
	});
	await updateTaskDB(taskId, { status: 'running', current_stage: stageName });

	try {
		await handler(taskId, sessionPath, task, daemon);
	} catch (err: any) {
		const msg = err.message ?? String(err);
		emitLog(taskId, `[ERROR] [Pipeline] Stage ${stageName} failed: ${msg}`);
		await updateStageDB(taskId, stageName, {
			status: 'failed',
			error_message: msg,
			completed_at: nowISO(),
		});
		await updateTaskDB(taskId, { status: 'failed', error_message: msg });
		return;
	}

	await updateStageDB(taskId, stageName, {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
		last_message: `${stage.label} completed`,
	});
	emitLog(taskId, `[Pipeline] Stage ${stageName} completed`);
}
