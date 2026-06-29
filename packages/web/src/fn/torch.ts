import { createServerFn } from '@tanstack/solid-start'
import { spawn, type ChildProcess } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { REPO_ROOT } from '@repo/config'
import { findServer, readPortFromOutput } from '../../../core/servers/discovery'
import type { ModelServerStatus } from '@repo/core/servers/type'

let _torchPort = 19109
let _voxcpmPort = 19112
let _proc: ChildProcess | null = null
let _voxcpm_proc: ChildProcess | null = null

type TorchStatus = ModelServerStatus

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
	try {
		const res = await fetch(`http://127.0.0.1:${port}/status`, {
			signal: AbortSignal.timeout(2000),
		})
		return res.ok
	} catch {
		return false
	}
}

export const startTorch = createServerFn().handler(async (): Promise<TorchStatus> => {
	const { port } = await findServer('torch', 19109)
	_torchPort = port
	if (await ping(port)) return fetchHealth(port)

	const pyBin = join(REPO_ROOT, '.venv', 'bin', 'python')
	const scriptPath = join(REPO_ROOT, 'packages', 'torch_server', 'pytorch_server.py')
	const voxcpmSrc = join(REPO_ROOT, 'submodule', 'VoxCPM', 'src')

	const env: Record<string, string> = {
		...((process as { env?: Record<string, string> }).env ?? {}),
		TORCHAUDIO_USE_BACKEND: 'soundfile',
	}
	const existingPy = env.PYTHONPATH ?? ''
	env.PYTHONPATH = existingPy ? `${voxcpmSrc}${delimiter}${existingPy}` : voxcpmSrc

	const proc = spawn(pyBin, [scriptPath, '--http-port', String(port)], {
		env,
		detached: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	})

	// Read PORT=N from stdout
	let stdout = ''
	proc.stdout?.on('data', (d: Buffer) => {
		stdout += d.toString()
	})
	proc.stderr?.pipe(process.stderr)
	proc.unref()
	_proc = proc

	const deadline = Date.now() + 60_000
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 200))
		if (await ping(_torchPort)) return fetchHealth(_torchPort)
		// Try to read port from buffered stdout
		const p = readPortFromOutput(stdout, _torchPort)
		if (p !== _torchPort) {
			_torchPort = p
		}
	}

	throw new Error('TorchServer startup timeout after 60000ms')
})

export const stopTorch = createServerFn().handler(async (): Promise<TorchStatus> => {
	try {
		await fetch(`http://127.0.0.1:${_torchPort}/api/shutdown`, { method: 'POST' })
	} catch {
		// already gone
	}
	if (_proc) {
		_proc.stdout?.destroy()
		_proc.stderr?.destroy()
		_proc = null
	}
	return { status: 'stopped', port: _torchPort, uptime_s: 0, models: {} }
})

export const restartTorch = createServerFn().handler(async (): Promise<TorchStatus> => {
	try {
		await fetch(`http://127.0.0.1:${_torchPort}/api/shutdown`, { method: 'POST' })
	} catch { /* ok */ }
	if (_proc) {
		_proc.stdout?.destroy()
		_proc.stderr?.destroy()
		_proc = null
	}

	await new Promise((r) => setTimeout(r, 1500))

	return startTorch()
})

export const checkTorch = createServerFn().handler(async (): Promise<TorchStatus> => {
	const { port } = await findServer('torch', _torchPort)
	_torchPort = port
	return fetchHealth(port)
})

// VoxCPM server management

interface VoxCpmStatus {
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
		const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(2000) })
		return res.ok
	} catch { return false }
}

export const startVoxCpm = createServerFn().handler(async (): Promise<VoxCpmStatus> => {
	const { port } = await findServer('voxcpm_torch_gradio', 19112)
	_voxcpmPort = port
	if (await pingVoxCpm(port)) return fetchVoxCpmHealth(port)

	const pyBin = join(REPO_ROOT, '.venv', 'bin', 'python')
	const scriptPath = join(REPO_ROOT, 'packages', 'voxcpm_torch_server', 'server.py')

	const proc = spawn(pyBin, [scriptPath, '--port', String(port), '--device', 'cpu'], {
		detached: true, stdio: ['ignore', 'pipe', 'pipe'],
	})

	// Read PORT=N from stdout
	let stdout = ''
	proc.stdout?.on('data', (d: Buffer) => {
		stdout += d.toString()
	})
	proc.stderr?.pipe(process.stderr)
	proc.unref()
	_voxcpm_proc = proc

	const deadline = Date.now() + 120_000
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 200))
		if (await pingVoxCpm(_voxcpmPort)) return fetchVoxCpmHealth(_voxcpmPort)
		const p = readPortFromOutput(stdout, _voxcpmPort)
		if (p !== _voxcpmPort) _voxcpmPort = p
	}
	return { running: false, model_loaded: false, model_status: 'timeout', model_device: '' }
})

export const checkVoxCpm = createServerFn().handler(async (): Promise<VoxCpmStatus> => {
	const { port } = await findServer('voxcpm_torch_gradio', _voxcpmPort)
	_voxcpmPort = port
	return fetchVoxCpmHealth(port)
})

export const stopVoxCpm = createServerFn().handler(async (): Promise<VoxCpmStatus> => {
	if (_voxcpm_proc) {
		_voxcpm_proc.stdout?.destroy()
		_voxcpm_proc.stderr?.destroy()
		_voxcpm_proc = null
	}
	return { running: false, model_loaded: false, model_status: 'stopped', model_device: '' }
})

export const restartVoxCpm = createServerFn().handler(async (): Promise<VoxCpmStatus> => {
	await stopVoxCpm()
	await new Promise((r) => setTimeout(r, 1500))
	return startVoxCpm()
})
