import { invoke } from '@tauri-apps/api/core'

const PORT = 19109

export interface TorchStatus {
	running: boolean
	uptime_s: number
	models: Record<string, boolean>
}

async function fetchHealth(): Promise<TorchStatus> {
	try {
		const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, {
			signal: AbortSignal.timeout(2000),
		})
		if (!res.ok) return { running: false, uptime_s: 0, models: {} }
		const data = (await res.json()) as { uptime_s?: number; models?: Record<string, boolean> }
		return {
			running: true,
			uptime_s: data.uptime_s ?? 0,
			models: data.models ?? {},
		}
	} catch {
		return { running: false, uptime_s: 0, models: {} }
	}
}

async function ping(): Promise<boolean> {
	try {
		const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, {
			signal: AbortSignal.timeout(2000),
		})
		return res.ok
	} catch {
		return false
	}
}

async function waitForHealth(timeoutMs = 60_000): Promise<TorchStatus> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 200))
		const status = await fetchHealth()
		if (status.running) return status
	}
	throw new Error(`TorchServer startup timeout after ${timeoutMs}ms`)
}

export async function startTorch(): Promise<TorchStatus> {
	if (await ping()) return fetchHealth()

	await invoke('start_torch')
	return waitForHealth()
}

export async function stopTorch(): Promise<TorchStatus> {
	try {
		await fetch(`http://127.0.0.1:${PORT}/api/shutdown`, { method: 'POST' })
	} catch {
		// already gone
	}
	await invoke('stop_torch')
	return { running: false, uptime_s: 0, models: {} }
}

export async function restartTorch(): Promise<TorchStatus> {
	// stop
	try {
		await fetch(`http://127.0.0.1:${PORT}/api/shutdown`, { method: 'POST' })
	} catch { /* ok */ }
	await invoke('stop_torch')

	// wait for full shutdown
	await new Promise((r) => setTimeout(r, 1500))

	// start
	await invoke('start_torch')
	return waitForHealth()
}

export async function checkTorch(): Promise<TorchStatus> {
	return fetchHealth()
}
