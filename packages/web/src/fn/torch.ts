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

async function fetchHealth(port: number): Promise<ModelServerStatus> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/status`, {
			signal: AbortSignal.timeout(2000),
		})
		if (!res.ok) return { status: 'stopped', port, uptime_s: 0, models: {} }
		const data = await res.json() as ModelServerStatus
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

export const startTorch = createServerFn().handler(async (): Promise<ModelServerStatus> => {
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
		const p = readPortFromOutput(stdout, _torchPort)
		if (p !== _torchPort) {
			_torchPort = p
		}
	}

	throw new Error('TorchServer startup timeout after 60000ms')
})

export const stopTorch = createServerFn().handler(async (): Promise<ModelServerStatus> => {
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

export const restartTorch = createServerFn().handler(async (): Promise<ModelServerStatus> => {
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

export const checkTorch = createServerFn().handler(async (): Promise<ModelServerStatus> => {
	const { port } = await findServer('torch', _torchPort)
	_torchPort = port
	return fetchHealth(port)
})

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
		const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(2000) })
		return res.ok
	} catch { return false }
}

async function waitForVoxCpm(port: number, timeoutMs = 120_000): Promise<ModelServerStatus> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 200))
		const status = await fetchVoxCpmHealth(port)
		if (status.status === 'running') return status
	}
	return { status: 'stopped', port, uptime_s: 0, models: { voxcpm: { status: 'error', device: '' } } }
}

export const startVoxCpm = createServerFn().handler(async (): Promise<ModelServerStatus> => {
	const { port } = await findServer('voxcpm_torch_gradio', 19112)
	_voxcpmPort = port
	if (await pingVoxCpm(port)) return fetchVoxCpmHealth(port)

	const pyBin = join(REPO_ROOT, '.venv', 'bin', 'python')
	const scriptPath = join(REPO_ROOT, 'packages', 'voxcpm_torch_server', 'server.py')

	const proc = spawn(pyBin, [scriptPath, '--port', String(port), '--device', 'cpu'], {
		detached: true, stdio: ['ignore', 'pipe', 'pipe'],
	})

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
	return { status: 'stopped', port, uptime_s: 0, models: { voxcpm: { status: 'error', device: '' } } }
})

export const checkVoxCpm = createServerFn().handler(async (): Promise<ModelServerStatus> => {
	const { port } = await findServer('voxcpm_torch_gradio', _voxcpmPort)
	_voxcpmPort = port
	return fetchVoxCpmHealth(port)
})

export const stopVoxCpm = createServerFn().handler(async (): Promise<ModelServerStatus> => {
	if (_voxcpm_proc) {
		_voxcpm_proc.stdout?.destroy()
		_voxcpm_proc.stderr?.destroy()
		_voxcpm_proc = null
	}
	return { status: 'stopped', port: _voxcpmPort, uptime_s: 0, models: { voxcpm: { status: 'unloaded', device: '' } } }
})

export const restartVoxCpm = createServerFn().handler(async (): Promise<ModelServerStatus> => {
	await stopVoxCpm()
	await new Promise((r) => setTimeout(r, 1500))
	return startVoxCpm()
})
