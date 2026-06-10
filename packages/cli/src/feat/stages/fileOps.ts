import { readFileSync, writeFileSync, copyFileSync, rmSync, mkdirSync, existsSync, type WriteFileOptions } from 'node:fs';
import { emitLog } from './utils.ts';

function log(taskId: string | undefined, op: string, path: string, extra?: string) {
	if (taskId) emitLog(taskId, `[File] ${op} ${path}${extra ? ' ' + extra : ''}`);
}

export function readJson<T = any>(path: string, taskId?: string): T {
	log(taskId, 'read', path);
	return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeJson(path: string, data: any, taskId?: string) {
	const raw = JSON.stringify(data, null, 2);
	writeFileSync(path, raw);
	const lines = raw.split('\n').length;
	log(taskId, 'write', path, `(${raw.length}B, ${lines} lines)`);
}

export function writeFile(path: string, content: string | Buffer, taskId?: string) {
	writeFileSync(path, content);
	log(taskId, 'write', path, `(${Buffer.byteLength(content)}B)`);
}

export function copyFile(src: string, dst: string, taskId?: string) {
	copyFileSync(src, dst);
	log(taskId, 'copy', `${src} → ${dst}`);
}

export function removeFile(path: string, taskId?: string) {
	if (!existsSync(path)) return;
	rmSync(path);
	log(taskId, 'rm', path);
}

export function ensureDir(path: string, taskId?: string) {
	if (existsSync(path)) return;
	mkdirSync(path, { recursive: true });
	log(taskId, 'mkdir', path);
}

export { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync, copyFileSync };
