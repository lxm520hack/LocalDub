import { REPO_ROOT } from '@repo/config';
import { spawnSync, spawn } from 'node:child_process';
import { basename, join, relative } from 'node:path';

export const playWav = (wavPath: string) => {
  spawn('ffplay', ['-nodisp', '-autoexit', wavPath], { stdio: 'ignore' }).unref();
  // -nodisp 不弹窗口，-autoexit 播完自动退出
}

const task_success_path = join(REPO_ROOT, 'assets', 'media', 'task_success.wav');
export const playTaskSuccess = () =>  playWav(task_success_path);
const task_fail_path = join(REPO_ROOT, 'assets', 'media', 'error.wav');
export const playTaskFail = () =>  playWav(task_fail_path);