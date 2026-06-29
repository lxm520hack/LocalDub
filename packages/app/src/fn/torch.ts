import { to } from '@repo/shared/lib/utils/try';
import { invoke } from './invoke'
import { findServer } from '../../../core/servers/discovery'
import type { ModelServerStatus } from '@repo/core/servers/type'

let _torchPort = 19109
let _voxcpmPort = 19112

async function fetchStatsRes(port: number) {
	return await fetch(`http://127.0.0.1:${port}/status`, {
		signal: AbortSignal.timeout(2000),
	})
}

async function fetchHealth(port: number): Promise<ModelServerStatus> {
	try {
		const res = await fetchStatsRes(port)
		if (!res.ok) return { status: 'stopped', port, uptime_s: 0, models: {} }
		const data = await res.json() as ModelServerStatus
		return { ...data, status: data.status === 'running' ? 'running' : 'error' }
	} catch {
		return { status: 'stopped', port, uptime_s: 0, models: {} }
	}
}

async function ping(port: number): Promise<boolean> {
	const [res, err] = await  to(fetchStatsRes(port))
	if (err) return false
	return res.ok
}

async function waitForHealth(port: number, timeoutMs = 60_000): Promise<ModelServerStatus> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 200))
		const status = await fetchHealth(port)
		if (status.status === 'running') return status
	}
	throw new Error(`TorchServer startup timeout after ${timeoutMs}ms`)
}

async function waitForVoxCpm(port: number, timeoutMs = 120_000): Promise<ModelServerStatus> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 200))
		const status = await fetchHealth(port)
		if (status.status === 'running') return status
	}
	return { status: 'stopped', port, uptime_s: 0, models: { voxcpm: { status: 'error', device: '' } } }
}

export async function startTorch(): Promise<ModelServerStatus> {
	const { port } = await findServer('torch', 19109)
	_torchPort = port
	if (await ping(port)) return fetchHealth(port)

	_torchPort = await invoke<number>('start_torch')
	return waitForHealth(_torchPort)
}

export async function stopTorch(): Promise<ModelServerStatus> {
	try {
		await fetch(`http://127.0.0.1:${_torchPort}/api/shutdown`, { method: 'POST' })
	} catch {
		// already gone
	}
	await invoke('stop_torch')
	return { status: 'stopped', port: _torchPort, uptime_s: 0, models: {} }
}

export async function restartTorch(): Promise<ModelServerStatus> {
	try {
		await fetch(`http://127.0.0.1:${_torchPort}/api/shutdown`, { method: 'POST' })
	} catch { /* ok */ }
	await invoke('stop_torch')

	await new Promise((r) => setTimeout(r, 1500))

	_torchPort = await invoke<number>('start_torch')
	return waitForHealth(_torchPort)
}

export async function checkTorch(): Promise<ModelServerStatus> {
	const { port } = await findServer('torch', _torchPort)
	_torchPort = port
	return fetchHealth(port)
}

// VoxCPM server management

async function fetchVoxCpmHealth(port: number): Promise<ModelServerStatus> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/status`, {
			signal: AbortSignal.timeout(2000),
		})
		if (!res.ok) return { status: 'stopped', port, uptime_s: 0, models: { voxcpm: { status: 'unloaded', device: '' } } }
		return await res.json() as ModelServerStatus
	} catch {
		return { status: 'stopped', port, uptime_s: 0, models: { voxcpm: { status: 'unloaded', device: '' } } }
	}
}

async function pingVoxCpm(port: number): Promise<boolean> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/status`, {
			signal: AbortSignal.timeout(2000),
		})
		return res.ok
	} catch {
		return false
	}
}

export async function startVoxCpm(): Promise<ModelServerStatus> {
	const { port } = await findServer('voxcpm_torch_gradio', 19112)
	_voxcpmPort = port
	if (await pingVoxCpm(port)) return fetchVoxCpmHealth(port)

	_voxcpmPort = await invoke<number>('start_voxcpm')
	return waitForVoxCpm(_voxcpmPort)
}

export async function checkVoxCpm(): Promise<ModelServerStatus> {
	const { port } = await findServer('voxcpm_torch_gradio', _voxcpmPort)
	_voxcpmPort = port
	return fetchVoxCpmHealth(port)
}

export async function stopVoxCpm(): Promise<ModelServerStatus> {
	await invoke('stop_voxcpm')
	return { status: 'stopped', port: _voxcpmPort, uptime_s: 0, models: { voxcpm: { status: 'unloaded', device: '' } } }
}

export async function restartVoxCpm(): Promise<ModelServerStatus> {
	await stopVoxCpm()
	await new Promise((r) => setTimeout(r, 1500))
	return startVoxCpm()
}
