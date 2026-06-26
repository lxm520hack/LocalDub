import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const start = performance.now();
  console.log(`[IPC] → ${command}`, args ?? '');
  try {
    const result = await tauriInvoke<T>(command, args);
    const ms = (performance.now() - start).toFixed(1);
    console.log(`[IPC] ← ${command} (${ms}ms)`);
    return result;
  } catch (error) {
    const ms = (performance.now() - start).toFixed(1);
    console.error(`[IPC] ✗ ${command} (${ms}ms)`, error);
    throw error;
  }
}
