import { readFileSync, writeFileSync, copyFileSync, rmSync, mkdirSync, existsSync, type WriteFileOptions } from 'node:fs';
import { Context } from '@repo/core/context/context';
import { emitLog } from '@repo/core/stages/utils/utils';

export function getLastSegment(path: string) {
	const last = path.replace(/\\/g, "/").split("/").filter(Boolean).pop();
	if (!last) throw new Error(`Invalid path: ${path}`);
  return last
}

export type FileOp = 'read' | 'write' | 'copy' | 'rm' | 'mkdir';

export function fileLog(ctx: Context, op: FileOp, path: string, extra?: string) {
	emitLog(ctx.task.session_path, `[${ctx.task.current_stage}] [File] ${op} ${path}${extra ? ' ' + extra : ''}`);
}

export   function readJson<T = any>(path: string,  ctx: Context){
	fileLog(ctx, 'read', path);
	
	return Bun.file(path).json() as Promise<T>; 
}

export function writeJson(path: string, data: any, ctx: Context) {
	const raw = JSON.stringify(data, null, 2);
	writeFileSync(path, raw);
	const lines = raw.split('\n').length;
	fileLog(ctx, 'write', path, `(${raw.length}B, ${lines} lines)`);
}

export function writeFile(path: string, content: string | Buffer, ctx: Context) {
	writeFileSync(path, content);
	fileLog(ctx, 'write', path, `(${Buffer.byteLength(content)}B)`);
}

export function copyFile(src: string, dst: string, ctx: Context) {
	copyFileSync(src, dst);
	fileLog(ctx, 'copy', `${src} → ${dst}`);
}

export function removeFile(path: string, ctx: Context) {
	if (!existsSync(path)) return;
	rmSync(path);
	fileLog(ctx, 'rm', path);
}

export function ensureDir(path: string, ctx: Context) {
	if (existsSync(path)) return;
	mkdirSync(path, { recursive: true });
	fileLog(ctx, 'mkdir', path);
}

export { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync, copyFileSync };
