import { ModelServerStatus } from "@repo/core/servers/type";

export const fetchStatsRes = (port: number) => fetch(`http://127.0.0.1:${port}/status`, {
  signal: AbortSignal.timeout(2000),
})

export const fetchStatsData = async (port: number): Promise<ModelServerStatus> => {
  const res = await fetchStatsRes(port);
  if (!res.ok) throw new Error(`Failed to fetch status from port ${port}: ${res.status}`);
  return await res.json() as ModelServerStatus;
}

export const getTorchServerUrl = (port: number) => `http://127.0.0.1:${port}`
function readSSE(
	stream: ReadableStream<Uint8Array>,
	onProgress?: ProgressCallback,
	onLog?: LogCallback,
): Promise<{ ok: true; output: Record<string, unknown> } | { ok: false; message: string }> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let currentEvent = '';
	let currentData = '';

	function dispatch() {
		if (currentEvent === 'progress') {
			const d = JSON.parse(currentData);
			onProgress?.(d.current, d.total, d.message);
			return null;
		}
		if (currentEvent === 'complete') {
			return { ok: true as const, output: JSON.parse(currentData).output ?? {} };
		}
		if (currentEvent === 'error') {
			return { ok: false as const, message: JSON.parse(currentData).message ?? 'Unknown error' };
		}
		if (currentEvent === 'log') {
			const d = JSON.parse(currentData) as { line?: string };
			onLog?.(d.line ?? '');
			return null;
		}
		return null;
	}

	return new Promise((resolve, reject) => {
		function pump() {
			reader.read().then(({ done, value }) => {
				if (done) {
					resolve({ ok: false, message: 'SSE stream ended without complete/error' });
					return;
				}
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n');
				buffer = parts.pop() ?? '';
				for (const line of parts) {
					if (line.startsWith('event: ')) {
						currentEvent = line.slice(7).trim();
					} else if (line.startsWith('data: ')) {
						currentData = line.slice(6).trim();
					} else if (line === '' && currentEvent) {
						const result = dispatch();
						if (result) {
							resolve(result);
							reader.cancel();
							return;
						}
						currentEvent = '';
						currentData = '';
					}
				}
				pump();
			}).catch(reject);
		}
		pump();
	});
}
type ProgressCallback = (current: number, total: number, message?: string) => void;
type LogCallback = (line: string) => void;
export async function runStage(
	baseUrl: string,
	stage: string,
	taskId: string,
	params: Record<string, unknown>,
	onProgress?: ProgressCallback,
	onLog?: LogCallback,
): Promise<Record<string, unknown>> {
	const res = await fetch(`${baseUrl}/api/run/${stage}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ task_id: taskId, params }),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`TorchServer HTTP ${res.status}: ${text}`);
	}
	if (!res.body) throw new Error('TorchServer returned empty response body');

	const result = await readSSE(res.body, onProgress, onLog);
	if (result.ok) return result.output;
	throw new Error(result.message);
}
