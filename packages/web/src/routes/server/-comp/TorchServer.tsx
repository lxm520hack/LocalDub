import { createSignal, onCleanup, onMount } from 'solid-js';
import { startTorch, stopTorch, restartTorch } from '../-fn/torch';
import { Button } from '@repo/ui-solid/base/button';
import { useMutation } from '@tanstack/solid-query';

interface HealthData {
  status: string;
  uptime_s: number;
  models: Record<string, boolean>;
}

function fmtUptime(s: number): string {
  if (!s) return '0s';
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return `${hh}h ${mm}m ${ss}s`;
}

export function TorchServer() {
  const [health, setHealth] = createSignal<HealthData | null>(null);
  const [logs, setLogs] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [errMsg, setErrMsg] = createSignal('');

  onMount(() => {
    const es = new EventSource('/torch_server/api/events');
    es.addEventListener('health', (e) => {
      try { setHealth(JSON.parse(e.data)); } catch {}
    });
    es.addEventListener('log', (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.lines != null) setLogs(d.lines);
      } catch {}
    });
    es.addEventListener('error', () => {});
    onCleanup(() => es.close());
  });

  const startServer = useMutation(()=>({}))
  async function handleStart() {
    setBusy(true);
    setErrMsg('');
    try {
      const s = await startTorch();
      if (s.running) setHealth({ status: 'ok', uptime_s: s.uptime_s, models: s.models });
      else setErrMsg('Server failed to start');
    } catch (e) {
      setErrMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    setErrMsg('');
    try {
      await stopTorch();
      setHealth(null);
    } catch (e) {
      setErrMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRestart() {
    setBusy(true);
    setErrMsg('');
    try {
      const s = await restartTorch();
      if (s.running) setHealth({ status: 'ok', uptime_s: s.uptime_s, models: s.models });
      else setErrMsg('Server failed to restart');
    } catch (e) {
      setErrMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  const running = () => health() !== null;

  return (
    <div class="p-8">
      <div class="flex items-center gap-3 mb-6">
        <div
          class="w-3 h-3 rounded-full shrink-0"
          style={{
            'background-color': running() ? '#22c55e' : '#ef4444',
          }}
        />
        <h1 class="text-2xl font-bold">Torch Server</h1>

        <div class="flex items-center gap-2 ml-4">
          <Button
            onClick={handleStart}
            disabled={busy() || running()}
            class="bg-green-500"
          >
            Start
          </Button>
          <button
            onClick={handleRestart}
            disabled={busy() || !running()}
            class="px-4 py-1.5 text-sm rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: '#854d0e',
              color: '#fef08a',
            }}
          >
            Restart
          </button>
          <button
            onClick={handleStop}
            disabled={busy() || !running()}
            class="px-4 py-1.5 text-sm rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: '#7f1d1d',
              color: '#fecaca',
            }}
          >
            Stop
          </button>
        </div>

        <span class="text-sm text-gray-500 ml-auto">
          {busy()
            ? 'working...'
            : running()
              ? `uptime ${fmtUptime(health()!.uptime_s)}`
              : 'stopped'}
        </span>
      </div>

      {errMsg() && (
        <div class="mb-6 p-3 rounded-lg bg-red-950/50 border border-red-800 text-red-300 text-sm">
          {errMsg()}
        </div>
      )}

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {Object.entries(health()?.models ?? {}).map(([name, loaded]) => (
          <div
            class="rounded-xl p-4 border transition-colors"
            style={{
              background: loaded ? '#1e293b' : '#0f172a',
              'border-color': loaded ? '#166534' : '#334155',
            }}
          >
            <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">
              {name}
            </div>
            <div
              class="text-sm font-medium"
              style={{ color: loaded ? '#4ade80' : '#64748b' }}
            >
              {loaded ? 'Loaded' : 'Idle'}
            </div>
          </div>
        ))}
      </div>

      <h2 class="text-lg font-semibold mb-3 text-gray-400">Server Log</h2>
      <pre class="bg-gray-950/50 border border-gray-800 text-gray-300 text-sm p-4 rounded-xl overflow-y-auto max-h-[55vh] font-mono leading-relaxed whitespace-pre-wrap">
        {logs() || <span class="text-gray-600 italic">No log output yet</span>}
      </pre>
    </div>
  );
}
