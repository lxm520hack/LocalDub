import { test, expect } from 'bun:test';
import { playTaskSuccess, playTaskFail } from './utils.ts';
import { task_success_path, task_fail_path } from '@repo/config/path/assets';
import { existsSync } from 'node:fs';

test('task_success_path 文件存在', () => {
  expect(existsSync(task_success_path)).toBe(true);
});

test('task_fail_path 文件存在', () => {
  expect(existsSync(task_fail_path)).toBe(true);
});

test('playTaskSuccess — 听一下 success 音效', () => {
  playTaskSuccess();
});

test('playTaskFail — 听一下 fail 音效', () => {
  playTaskFail();
});
