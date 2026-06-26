import { createSignal, onCleanup, onMount } from 'solid-js';
import { useMutation } from '@tanstack/solid-query';
import { Button } from '@repo/ui-solid/base/button';
import { toastError } from '@repo/ui-solid/custom/toast';
import type { TorchStatus } from './types';

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

interface Props {
  startTorch: () => Promise<TorchStatus>;
  stopTorch: () => Promise<TorchStatus>;
  restartTorch: () => Promise<TorchStatus>;
  sseUrl: string;
}

export function TorchServer(props: Props) {
  const [health, setHealth] = createSignal<HealthData | null>(null);
  const [logs, setLogs] = createSignal('');
  const [errMsg, setErrMsg] = createSignal('');
  let lastLineCount = 0;

  onMount(() => {
    const es = new EventSource(props.sseUrl);
    es.addEventListener('health', (e) => {
      try { setHealth(JSON.parse(e.data)); } catch {}
    });
    es.addEventListener('log', (e) => {
      try {
        const d = JSON.parse(e.data) as { lines?: string; count?: number };
        if (d.lines == null) return;
        if (!d.count) { setLogs(d.lines); lastLineCount = 0; return; }
        if (lastLineCount === 0) {
          setLogs(d.lines);
        } else if (d.count > lastLineCount) {
          const lines = d.lines.split('\n');
          const newCount = d.count - lastLineCount;
          const newLines = lines.slice(-newCount).join('\n');
          setLogs(prev => {
            const next = prev + '\n' + newLines;
            const all = next.split('\n');
            return all.length > 5000 ? all.slice(-5000).join('\n') : next;
          });
        }
        lastLineCount = d.count;
      } catch {}
    });
    es.addEventListener('error', () => {});
    onCleanup(() => es.close());
  });

  const startMutation = useMutation(() => ({
    mutationFn: () => props.startTorch(),
    onMutate: () => setErrMsg(''),
    onSuccess: (s) => {
      if (s.running) setHealth({ status: 'ok', uptime_s: s.uptime_s, models: s.models });
    },
    onError: (e) => toastError(e),
  }));

  const stopMutation = useMutation(() => ({
    mutationFn: () => props.stopTorch(),
    onMutate: () => setErrMsg(''),
    onSuccess: () => setHealth(null),
    onError: (e) => toastError(e),
  }));

  const restartMutation = useMutation(() => ({
    mutationFn: () => props.restartTorch(),
    onMutate: () => setErrMsg(''),
    onSuccess: (s) => {
      if (s.running) setHealth({ status: 'ok', uptime_s: s.uptime_s, models: s.models });
    },
    onError: (e) => toastError(e),
  }));

  const busy = () => startMutation.isPending || stopMutation.isPending || restartMutation.isPending;
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
            variant='ghost'
            onClick={() =>startMutation.mutate()}
            disabled={busy() || running()}
            class=" font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-green-400"
          >
            Start
          </Button>
          <Button
            onClick={() => {  restartMutation.mutate(); }}
            disabled={busy() || !running()}
            class=" font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-amber-300"
          >
            Restart
          </Button>
          <Button
            onClick={() => {  stopMutation.mutate(); }}
            disabled={busy() || !running()}
            class="font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-red-400"
          >
            Stop
          </Button>
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
