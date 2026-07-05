import { task_fail_path, task_success_path } from '@repo/config/path/assets';
import { REPO_ROOT } from '@repo/config/root';
import { spawnSync, spawn } from 'node:child_process';
import { basename, join, relative } from 'node:path';


// -nodisp 不弹窗口，-autoexit 播完自动退出
export const playWav = (wavPath: string) => spawnSync('ffplay', ['-nodisp', '-autoexit', wavPath], { stdio: 'ignore' })

export const playTaskSuccess = () =>  playWav(task_success_path);
export const playTaskFail = () =>  playWav(task_fail_path);