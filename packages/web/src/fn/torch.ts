import { createServerFn } from '@tanstack/solid-start'
import { spawn, type ChildProcess } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { REPO_ROOT } from '@repo/config'

const PORT = 19109

let _proc: ChildProcess | null = null

interface TorchStatus {
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

export const startTorch = createServerFn().handler(async (): Promise<TorchStatus> => {
	if (await ping()) return fetchHealth()

	const pyBin = join(REPO_ROOT, '.venv', 'bin', 'python')
	const scriptPath = join(REPO_ROOT, 'packages', 'cli', 'src', 'ml', 'server', 'pytorch_server.py')
	const voxcpmSrc = join(REPO_ROOT, 'submodule', 'VoxCPM', 'src')

	const env: Record<string, string> = {
		...((process as { env?: Record<string, string> }).env ?? {}),
		TORCHAUDIO_USE_BACKEND: 'soundfile',
	}
	const existingPy = env.PYTHONPATH ?? ''
	env.PYTHONPATH = existingPy ? `${voxcpmSrc}${delimiter}${existingPy}` : voxcpmSrc

	const proc = spawn(pyBin, [scriptPath, '--http-port', String(PORT)], {
		env,
		detached: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	proc.stderr?.pipe(process.stderr)
	proc.unref()
	_proc = proc

	const deadline = Date.now() + 60_000
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 200))
		if (await ping()) return fetchHealth()
	}

	throw new Error('TorchServer startup timeout after 60000ms')
})

export const stopTorch = createServerFn().handler(async (): Promise<TorchStatus> => {
	try {
		await fetch(`http://127.0.0.1:${PORT}/api/shutdown`, { method: 'POST' })
	} catch {
		// already gone
	}
	if (_proc) {
		_proc.stdout?.destroy()
		_proc.stderr?.destroy()
		_proc = null
	}
	return { running: false, uptime_s: 0, models: {} }
})

export const restartTorch = createServerFn().handler(async (): Promise<TorchStatus> => {
	// stop
	try {
		await fetch(`http://127.0.0.1:${PORT}/api/shutdown`, { method: 'POST' })
	} catch { /* ok */ }
	if (_proc) {
		_proc.stdout?.destroy()
		_proc.stderr?.destroy()
		_proc = null
	}

	// wait for full shutdown
	await new Promise((r) => setTimeout(r, 1500))

	// start
	return startTorch()
})

export const checkTorch = createServerFn().handler(async (): Promise<TorchStatus> => fetchHealth())
