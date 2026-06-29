import { to } from '@repo/shared/lib/utils/try';
import { invoke } from './invoke'
import { findServer } from '../../../core/servers/discovery'
import type { ModelServerStatus } from '@repo/core/servers/type'

let _torchPort = 19109
let _voxcpmPort = 19112

export type TorchStatus = ModelServerStatus

async function fetchStatsRes(port: number) {
	return await fetch(`http://127.0.0.1:${port}/status`, {
		signal: AbortSignal.timeout(2000),
	})
}

async function fetchHealth(port: number): Promise<TorchStatus> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/status`, {
			signal: AbortSignal.timeout(2000),
		})
		if (!res.ok) return { status: 'stopped', port, uptime_s: 0, models: {} }
		const data = await res.json() as TorchStatus
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

async function waitForHealth(port: number, timeoutMs = 60_000): Promise<TorchStatus> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 200))
		const status = await fetchHealth(port)
		if (status.status === 'running') return status
	}
	throw new Error(`TorchServer startup timeout after ${timeoutMs}ms`)
}

export async function startTorch(): Promise<TorchStatus> {
	const { port } = await findServer('torch', 19109)
	_torchPort = port
	if (await ping(port)) return fetchHealth(port)

	_torchPort = await invoke<number>('start_torch')
	return waitForHealth(_torchPort)
}

export async function stopTorch(): Promise<TorchStatus> {
	try {
		await fetch(`http://127.0.0.1:${_torchPort}/api/shutdown`, { method: 'POST' })
	} catch {
		// already gone
	}
	await invoke('stop_torch')
	return { status: 'stopped', port: _torchPort, uptime_s: 0, models: {} }
}

export async function restartTorch(): Promise<TorchStatus> {
	try {
		await fetch(`http://127.0.0.1:${_torchPort}/api/shutdown`, { method: 'POST' })
	} catch { /* ok */ }
	await invoke('stop_torch')

	await new Promise((r) => setTimeout(r, 1500))

	_torchPort = await invoke<number>('start_torch')
	return waitForHealth(_torchPort)
}

export async function checkTorch(): Promise<TorchStatus> {
	const { port } = await findServer('torch', _torchPort)
	_torchPort = port
	return fetchHealth(port)
}

// VoxCPM server management

export interface VoxCpmStatus {
	running: boolean
	model_loaded: boolean
	model_status: string
	model_device: string
}

async function fetchVoxCpmHealth(port: number): Promise<VoxCpmStatus> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/status`, {
			signal: AbortSignal.timeout(2000),
		})
		if (!res.ok) return { running: false, model_loaded: false, model_status: 'stopped', model_device: '' }
		const data = await res.json() as ModelServerStatus
		const vox = data.models ? Object.values(data.models)[0] : undefined
		return {
			running: data.status === 'running',
			model_loaded: vox?.status === 'ready',
			model_status: vox?.status ?? 'unknown',
			model_device: vox?.device ?? '',
		}
	} catch {
		return { running: false, model_loaded: false, model_status: 'stopped', model_device: '' }
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

async function waitForVoxCpm(port: number, timeoutMs = 120_000): Promise<VoxCpmStatus> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 200))
		const status = await fetchVoxCpmHealth(port)
		if (status.running) return status
	}
	return { running: false, model_loaded: false, model_status: 'timeout', model_device: '' }
}

export async function startVoxCpm(): Promise<VoxCpmStatus> {
	const { port } = await findServer('voxcpm_torch_gradio', 19112)
	_voxcpmPort = port
	if (await pingVoxCpm(port)) return fetchVoxCpmHealth(port)

	_voxcpmPort = await invoke<number>('start_voxcpm')
	return waitForVoxCpm(_voxcpmPort)
}

export async function checkVoxCpm(): Promise<VoxCpmStatus> {
	const { port } = await findServer('voxcpm_torch_gradio', _voxcpmPort)
	_voxcpmPort = port
	return fetchVoxCpmHealth(port)
}

export async function stopVoxCpm(): Promise<VoxCpmStatus> {
	await invoke('stop_voxcpm')
	return { running: false, model_loaded: false, model_status: 'stopped', model_device: '' }
}

export async function restartVoxCpm(): Promise<VoxCpmStatus> {
	await stopVoxCpm()
	await new Promise((r) => setTimeout(r, 1500))
	return startVoxCpm()
}
