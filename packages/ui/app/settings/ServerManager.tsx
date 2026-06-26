import { createSignal, onCleanup, onMount } from 'solid-js';
import { useMutation } from '@tanstack/solid-query';
import { Button } from '@repo/ui-solid/base/button';
import { CardX } from '@repo/ui-solid/custom/card';
import { toastError } from '@repo/ui-solid/custom/toast';
import { useClientApi } from '../api/context';

const SSE_URL = 'http://127.0.0.1:19109/api/events';

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

export function ServerManager() {
  const [health, setHealth] = createSignal<HealthData | null>(null);
  const api = useClientApi().serversManagerApi;
  if (!api) return null;

  onMount(() => {
    const es = new EventSource(SSE_URL);
    es.addEventListener('health', (e) => {
      try { setHealth(JSON.parse(e.data)); } catch {}
    });
    es.addEventListener('error', () => {});
    onCleanup(() => es.close());
  });

  const startMutation = useMutation(() => ({
    mutationFn: () => api.startTorch(),
    onSuccess: (s) => {
      if (s.running) setHealth({ status: 'ok', uptime_s: s.uptime_s, models: s.models });
    },
    onError: (e) => toastError(e),
  }));

  const stopMutation = useMutation(() => ({
    mutationFn: () => api.stopTorch(),
    onSuccess: () => setHealth(null),
    onError: (e) => toastError(e),
  }));

  const restartMutation = useMutation(() => ({
    mutationFn: () => api.restartTorch(),
    onSuccess: (s) => {
      if (s.running) setHealth({ status: 'ok', uptime_s: s.uptime_s, models: s.models });
    },
    onError: (e) => toastError(e),
  }));

  const busy = () => startMutation.isPending || stopMutation.isPending || restartMutation.isPending;
  const running = () => health() !== null;

  return (
    <div class="space-y-4">
      <div class="flex items-center gap-3">
        <div
          class="w-3 h-3 rounded-full shrink-0"
          style={{ 'background-color': running() ? '#22c55e' : '#ef4444' }}
        />
        <span class="font-medium">Torch Server</span>
        <span class="text-sm text-gray-500 ml-auto">
          {busy()
            ? 'working...'
            : running()
              ? `uptime ${fmtUptime(health()!.uptime_s)}`
              : 'stopped'}
        </span>
      </div>

      <div class="flex gap-2">
        <Button
          variant='ghost'
          onClick={() => startMutation.mutate()}
          disabled={busy() || running()}
          class="font-medium bg-green-400 disabled:opacity-40"
        >
          Start
        </Button>
        <Button
          onClick={() => restartMutation.mutate()}
          disabled={busy() || !running()}
          class="font-medium bg-amber-300 disabled:opacity-40"
        >
          Restart
        </Button>
        <Button
          onClick={() => stopMutation.mutate()}
          disabled={busy() || !running()}
          class="font-medium bg-red-400 disabled:opacity-40"
        >
          Stop
        </Button>
      </div>

      <div class="grid grid-cols-3 gap-3">
        {Object.entries(health()?.models ?? {}).map(([name, loaded]) => (
          <CardX
            title={name}
            size="sm"
            Footer={
              <span class={loaded ? 'text-green-400' : 'text-gray-500'}>
                {loaded ? 'Loaded' : 'Idle'}
              </span>
            }
          />
        ))}
      </div>
    </div>
  );
}
