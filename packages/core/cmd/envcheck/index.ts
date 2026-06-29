import { allChecks, ensureFns } from './items';
import { envDescribeMap, envList } from './input';
import type { CheckResult } from './types';
import type { EnvName } from './input';

function resolveTargets(targets?: string[]): string[] {
  if (!targets || targets.length === 0) return envList as string[];
  const valid = targets.filter(t => t in allChecks);
  if (valid.length === 0) return envList as string[];
  return valid;
}

export async function runCheck(targets?: string[]): Promise<CheckResult[]> {
  const selected = resolveTargets(targets);
  const results: CheckResult[] = [];

  for (const key of selected) {
    const fn = allChecks[key];
    if (!fn) {
      results.push({ key, status: 'skip' as any, message: 'no check defined', required: false });
      continue;
    }
    try {
      const r = await fn();
      results.push(r);
    } catch (e: any) {
      results.push({ key, status: 'fail' as any, message: `Error: ${e.message || e}`, required: false });
    }
  }

  return results;
}

export async function runEnsure(targets?: string[]): Promise<CheckResult[]> {
  const selected = resolveTargets(targets);
  const results: CheckResult[] = [];

  for (const key of selected) {
    const fn = ensureFns[key];
    if (!fn) {
      const desc = envDescribeMap[key as EnvName];
      results.push({
        key,
        status: 'skip' as any,
        message: `auto-fix not available${desc ? ` (${desc.en})` : ''}`,
        required: false,
      });
      continue;
    }
    try {
      const r = await fn();
      results.push(r);
    } catch (e: any) {
      results.push({ key, status: 'fail' as any, message: `Ensure error: ${e.message || e}`, required: false });
    }
  }

  return results;
}
