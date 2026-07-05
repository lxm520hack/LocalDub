import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readTask } from '@repo/core/context/context';
import { workfolder } from '@repo/config/env';

interface TaskBrief {
  taskId: string;
  title: string | null;
  status: string;
  current_stage: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface GroupInfo {
  groupId: string;
  taskCount: number;
  created_at: string | null;
  tasks: TaskBrief[];
}

export const get_group_list = async () => {
  const wf = workfolder();
  const groups: GroupInfo[] = [];

  const entries = readdirSync(wf, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const groupPath = join(wf, entry.name);
    const tasks: TaskBrief[] = [];

    const taskEntries = readdirSync(groupPath, { withFileTypes: true });
    for (const taskEntry of taskEntries) {
      if (!taskEntry.isDirectory()) continue;
      const taskPath = join(groupPath, taskEntry.name);
      try {
        const task = readTask(taskPath);
        tasks.push({
          taskId: task.id,
          title: task.title ?? null,
          status: task.status,
          current_stage: task.current_stage ?? null,
          created_at: task.created_at,
          started_at: task.started_at ?? null,
          completed_at: task.completed_at ?? null,
        });
      } catch {
        // skip invalid/missing ctx.json
      }
    }

    tasks.sort((a, b) => b.created_at.localeCompare(a.created_at));

    let created_at: string | null = null;
    try {
      const st = statSync(groupPath);
      created_at = st.birthtimeMs ? st.birthtime.toISOString() : null;
    } catch {
      // stat failed
    }
    if (!created_at && tasks.length > 0) {
      created_at = tasks[tasks.length - 1].created_at;
    }

    groups.push({
      groupId: entry.name,
      taskCount: tasks.length,
      created_at,
      tasks,
    });
  }

  groups.sort((a, b) => {
    if (!a.created_at && !b.created_at) return a.groupId.localeCompare(b.groupId);
    if (!a.created_at) return 1;
    if (!b.created_at) return -1;
    return b.created_at.localeCompare(a.created_at);
  });

  return groups
};