import type { ModelServerStatus } from '@repo/core/servers/type';

export async function torchStatus(port: number): Promise<ModelServerStatus> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(2000) });
		return await res.json() as ModelServerStatus;
	} catch {
		return {
			status: 'stopped', port, uptime_s: 0, message: 'Not running',
			models: { asr: { status: 'unloaded', device: '' }, separate: { status: 'unloaded', device: '' } },
		};
	}
}
