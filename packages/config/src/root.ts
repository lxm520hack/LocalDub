import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function hasWorkspaces(packageJsonPath: string): boolean {
  if (!existsSync(packageJsonPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return Boolean(pkg.workspaces);
  } catch {
    return false;
  }
}

function findRepoRoot(startDir: string): string {
  const envRoot = process.env.REPO_ROOT?.trim();
  if (envRoot) return resolve(envRoot);
  let currentDir = startDir;
  for (;;) {
    if (hasWorkspaces(resolve(currentDir, 'package.json'))) return currentDir;
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return resolve(startDir, '../../..');
}

export const REPO_ROOT = findRepoRoot(__dirname);
