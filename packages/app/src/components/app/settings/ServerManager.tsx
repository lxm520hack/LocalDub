import { createSignal, onCleanup, onMount } from 'solid-js';
import { createQuery, useMutation } from '@tanstack/solid-query';
import { Button } from '@repo/ui-solid/base/button';
import { CardX } from '@repo/ui-solid/custom/card';
import { toastError } from '@repo/ui-solid/custom/toast';
import { ModelServerStatus } from '@repo/core/servers/type';
import { rspc } from '#/integrations/rspc/rspc.ts';
import { checkTorch, checkVoxCpm, restartTorch, restartVoxCpm, startTorch, startVoxCpm, stopTorch, stopVoxCpm } from '#/feat/servers/servers.ts';

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

  const torchHealth = createQuery( ()=>({
    queryKey: ['torchHealth'],
    queryFn: checkTorch,
    staleTime: 3000,
  }))

  const voxcpmHealth = createQuery(()=>({
    queryKey: ['voxcpmHealth'],
    queryFn: checkVoxCpm,
    staleTime: 3000,
  }))


  const startTorchM = useMutation(() => ({ mutationFn: startTorch, onError: (e) => toastError(e) }));
  const stopTorchM = useMutation(() => ({ mutationFn: stopTorch, onError: (e) => toastError(e) }));
  const restartTorchM = useMutation(() => ({ mutationFn: restartTorch, onError: (e) => toastError(e) }));

  const startVox = useMutation(() => ({ mutationFn: startVoxCpm, onError: (e) => toastError(e) }));
  const stopVox = useMutation(() => ({ mutationFn: stopVoxCpm, onError: (e) => toastError(e) }));
  const restartVox = useMutation(() => ({ mutationFn: restartVoxCpm, onError: (e) => toastError(e) }));

  const torchModels = () => {
    const m = torchHealth.data?.models;
    if (!m || Object.keys(m).length === 0) return { asr: { status: 'unloaded', device: '' }, separate: { status: 'unloaded', device: '' } };
    return m;
  };

  const vcModels = () => {
    const m = voxcpmHealth.data?.models;
    if (!m) return { voxcpm: { status: 'unloaded', device: '' } };
    return m;
  };

  return (
    <div class="space-y-4">
      <ServerCard
        name="Torch Server"
        running={torchHealth.data?.status === 'running'}
        uptimeS={torchHealth.data?.uptime_s ?? 0}
        port={torchHealth.data?.port ?? 19109}
        models={torchModels()}
        busy={startTorchM.isPending || stopTorchM.isPending || restartTorchM.isPending}
        onStart={() => startTorchM.mutate()}
        onStop={() => stopTorchM.mutate()}
        onRestart={() => restartTorchM.mutate()}
      />
      <ServerCard
        name="VoxCPM PyTorch Server"
        running={voxcpmHealth.data?.status === 'running'}
        uptimeS={voxcpmHealth.data?.uptime_s ?? 0}
        port={voxcpmHealth.data?.port ?? 19112}
        models={vcModels()}
        busy={startVox.isPending || stopVox.isPending || restartVox.isPending}
        onStart={() => startVox.mutate()}
        onStop={() => stopVox.mutate()}
        onRestart={() => restartVox.mutate()}
      />
    </div>
  );
}
