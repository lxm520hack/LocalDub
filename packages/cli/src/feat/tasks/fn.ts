import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db } from './../../db/index.ts';
import { getStages, DUB_STAGES } from './../../feat/tasks/stages.ts';
import { taskStages, tasks } from './../../feat/tasks/table.ts';
import type { TargetLang } from '../config/types.ts';
import { WORKFOLDER } from '@repo/config';

export function sanitizeText(value: string, fallback = 'untitled'): string {
  const cleaned = value.replace(/[^\w\u4e00-\u9fff.-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+|[._]+$/g, '');
  return cleaned.slice(0, 120) || fallback;
}

export function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '');
}

export async function findTaskByVideoId(
  videoId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(sql`${tasks.id} = ${videoId} OR ${tasks.url} LIKE ${`%${videoId}%`}`)
    .orderBy(sql`created_at DESC, rowid DESC`)
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function createTask(params: {
  url?: string;
  taskId: string;
  sourceFile?: string;
  sourceLang?: string;
  targetLang?: TargetLang;
  mode?: string;
  stages?: Record<string, Record<string, unknown>>;
}) {
  const createdAt = nowISO();
  const mode = params.mode || 'dub';
  let taskUrl = params.url!;

  if (params.sourceFile) {
    const direction = `${params.sourceLang || 'auto'}-${params.targetLang || 'en'}`;
    const uploadDir = join(WORKFOLDER, '_uploads', params.taskId);
    mkdirSync(uploadDir, { recursive: true });

    let filename: string;
    if (params.sourceFile.startsWith('http://') || params.sourceFile.startsWith('https://')) {
      const url = new URL(params.sourceFile);
      filename = basename(url.pathname) || 'video.mp4';
      const resp = await fetch(params.sourceFile);
      if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      writeFileSync(join(uploadDir, filename), buf);
    } else {
      filename = basename(params.sourceFile);
      copyFileSync(params.sourceFile, join(uploadDir, filename));
    }
    taskUrl = `local://upload/${params.taskId}?direction=${direction}&filename=${encodeURIComponent(filename)}`;

    const sessionPath = join(WORKFOLDER, 'local', params.taskId);
    mkdirSync(join(sessionPath, 'metadata'), { recursive: true });
    const localInfo: Record<string, any> = {
      id: params.taskId,
      title: filename.replace(/\.\w+$/, ''),
      source: 'local',
      webpage_url: taskUrl,
      original_path: params.sourceFile,
      asr_language: params.sourceLang || 'auto',
      mode,
      lastRunMode: mode,
    };
    if (params.targetLang) {
      localInfo.target_language = params.targetLang;
    }
    if (params.stages) {
      localInfo.stages = params.stages;
    }
    writeFileSync(join(sessionPath, 'metadata', 'local_info.json'), JSON.stringify(localInfo, null, 2));
  }

  const stages = getStages(mode);

  const { ret } = await db.transaction(async (tx) => {
    const ret = await tx
      .insert(tasks)
      .values({
        id: params.taskId,
        url: taskUrl,
        status: 'queued',
        current_stage: stages[0].name,
        created_at: createdAt,
      })
      .returning();

    await tx
      .insert(taskStages)
      .values(
        stages.map((stage) => ({
          task_id: params.taskId,
          name: stage.name,
          label: stage.label,
          status: 'pending',
        })),
      );

    return { ret };
  });

  if (params.sourceFile) {
    await db.update(tasks).set({ session_path: `workfolder/local/${params.taskId}` }).where(eq(tasks.id, params.taskId));
  }

  return ret;
}

const STAGE_ORDER_CASE = sql`CASE ${DUB_STAGES.map(
  (s, i) => sql`WHEN ${taskStages.name} = ${s.name} THEN ${i + 1}`,
)} ELSE 99 END`;

export async function updateTask(
  taskId: string,
  fields: Record<string, unknown>,
) {
  if (Object.keys(fields).length === 0) return;
  await db.update(tasks).set(fields).where(eq(tasks.id, taskId));
}

export async function updateStage(
  taskId: string,
  name: string,
  fields: Record<string, unknown>,
) {
  if (Object.keys(fields).length === 0) return;
  await db
    .update(taskStages)
    .set(fields)
    .where(
      sql`${taskStages.task_id} = ${taskId} AND ${taskStages.name} = ${name}`,
    );
}

export async function deleteTask(taskId: string) {
  await db.delete(tasks).where(eq(tasks.id, taskId));
}
