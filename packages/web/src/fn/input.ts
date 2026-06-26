import { createServerFn } from '@tanstack/solid-start';

export const readInput = createServerFn().handler(async (): Promise<string> => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { REPO_ROOT } = await import('@repo/config');
  return readFileSync(join(REPO_ROOT, 'packages', 'cli', 'input.json'), 'utf-8');
});

export const writeInput = createServerFn().handler(async (content: string): Promise<void> => {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { REPO_ROOT } = await import('@repo/config');
  writeFileSync(join(REPO_ROOT, 'packages', 'cli', 'input.json'), content, 'utf-8');
});

export const readInputSchema = createServerFn().handler(async (): Promise<string> => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { REPO_ROOT } = await import('@repo/config');
  return readFileSync(join(REPO_ROOT, 'packages', 'cli', 'input.schema.json'), 'utf-8');
});
