import { createSignal, onCleanup, onMount } from 'solid-js';
import { useMutation } from '@tanstack/solid-query';
import { Button } from '@repo/ui-solid/base/button';
import { CardX } from '@repo/ui-solid/custom/card';
import { toastError } from '@repo/ui-solid/custom/toast';
import { useClientApi, type ModelServerStatus } from '../api/context';

function fmtUptime(s: number): string {
  if (!s) return '0s';
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return `${hh}h ${mm}m ${ss}s`;
}

function ServerCard(props: {
  name: string;
  running: boolean;
  uptimeS: number;
  port: number;
  models: Record<string, { status: string; device: string }>;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  return (
    <div class="space-y-3 p-4 border rounded-lg">
      <div class="flex items-center gap-3">
        <div
          class="w-3 h-3 rounded-full shrink-0"
          style={{ 'background-color': props.running ? '#22c55e' : '#ef4444' }}
        />
        <span class="font-medium">{props.name}</span>
        <span class="text-sm text-gray-500 ml-auto">
          {props.busy
            ? 'working...'
            : props.running
              ? `uptime ${fmtUptime(props.uptimeS)}`
              : 'stopped'}
        </span>
      </div>

      {props.running ? (
        <div class="text-xs text-gray-400">
          http://127.0.0.1:{props.port}
        </div>
      ) : null}

      <div class="flex gap-2">
        <Button
          variant='ghost'
          onClick={props.onStart}
          disabled={props.busy || props.running}
          class="font-medium bg-green-400 disabled:opacity-40"
        >
          Start
        </Button>
        <Button
          onClick={props.onRestart}
          disabled={props.busy || !props.running}
          class="font-medium bg-amber-300 disabled:opacity-40"
        >
          Restart
        </Button>
        <Button
          onClick={props.onStop}
          disabled={props.busy || !props.running}
          class="font-medium bg-red-400 disabled:opacity-40"
        >
          Stop
        </Button>
      </div>

      <div class="flex flex-wrap gap-2">
        {Object.entries(props.models).map(([name, m]) => (
          <span
            class={`text-xs px-2 py-0.5 rounded ${
              m.status === 'ready' ? 'bg-green-900/40 text-green-400' : 'bg-gray-800 text-gray-500'
            }`}
          >
            {name}: {m.status}{m.device ? ` (${m.device})` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ServerManager() {
  const [torchHealth, setTorchHealth] = createSignal<ModelServerStatus | null>(null);
  const [voxcpmHealth, setVoxCpmHealth] = createSignal<ModelServerStatus | null>(null);
  const api = useClientApi().serversManagerApi;
  if (!api) return null;

  onMount(() => {
    const iv = setInterval(async () => {
      try { setTorchHealth(await api.checkTorch()); }
      catch { setTorchHealth(null); }
    }, 3000);
    onCleanup(() => clearInterval(iv));
  });

  onMount(() => {
    const iv = setInterval(async () => {
      try { setVoxCpmHealth(await api.checkVoxCpm()); }
      catch { setVoxCpmHealth(null); }
    }, 3000);
    onCleanup(() => clearInterval(iv));
  });

  const startTorch = useMutation(() => ({ mutationFn: () => api.startTorch(), onError: (e) => toastError(e) }));
  const stopTorch = useMutation(() => ({ mutationFn: () => api.stopTorch(), onError: (e) => toastError(e) }));
  const restartTorch = useMutation(() => ({ mutationFn: () => api.restartTorch(), onError: (e) => toastError(e) }));

  const startVox = useMutation(() => ({ mutationFn: () => api.startVoxCpm(), onError: (e) => toastError(e) }));
  const stopVox = useMutation(() => ({ mutationFn: () => api.stopVoxCpm(), onError: (e) => toastError(e) }));
  const restartVox = useMutation(() => ({ mutationFn: () => api.restartVoxCpm(), onError: (e) => toastError(e) }));

  const torchModels = () => {
    const m = torchHealth()?.models;
    if (!m || Object.keys(m).length === 0) return { asr: { status: 'unloaded', device: '' }, separate: { status: 'unloaded', device: '' } };
    return m;
  };

  const vcModels = () => {
    const m = voxcpmHealth()?.models;
    if (!m) return { voxcpm: { status: 'unloaded', device: '' } };
    return m;
  };

  return (
    <div class="space-y-4">
      <ServerCard
        name="Torch Server"
        running={torchHealth()?.status === 'running'}
        uptimeS={torchHealth()?.uptime_s ?? 0}
        port={torchHealth()?.port ?? 19109}
        models={torchModels()}
        busy={startTorch.isPending || stopTorch.isPending || restartTorch.isPending}
        onStart={() => startTorch.mutate()}
        onStop={() => stopTorch.mutate()}
        onRestart={() => restartTorch.mutate()}
      />
      <ServerCard
        name="VoxCPM Server"
        running={voxcpmHealth()?.status === 'running'}
        uptimeS={voxcpmHealth()?.uptime_s ?? 0}
        port={voxcpmHealth()?.port ?? 19112}
        models={vcModels()}
        busy={startVox.isPending || stopVox.isPending || restartVox.isPending}
        onStart={() => startVox.mutate()}
        onStop={() => stopVox.mutate()}
        onRestart={() => restartVox.mutate()}
      />
    </div>
  );
}
