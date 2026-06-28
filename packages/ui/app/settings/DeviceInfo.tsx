import { createEffect, createResource, Show } from 'solid-js';
import { useClientApi } from '../api/context';

export function DeviceInfo() {
  const api = useClientApi().deviceInfoApi;
  const [data] = createResource(() => api?.fetchDeviceInfo());

  if (!api) return null;

  return (
    <div class="space-y-3">
      {data.loading && <p class="text-sm text-gray-500">Loading device info...</p>}
      {data.error && <p class="text-sm text-red-400">Failed to fetch: {data.error.message}</p>}
      <Show when={data()}>
        {d => (
    <>
          <section>
            <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">System</h3>
            <dl class="space-y-1 text-sm">
              <div class="flex gap-3"><dt class="w-24 text-gray-500">OS</dt><dd>{d().platform.os} {d().platform.arch}</dd></div>
              <div class="flex gap-3"><dt class="w-24 text-gray-500">Host</dt><dd>{d().platform.hostname}</dd></div>
              <div class="flex gap-3"><dt class="w-24 text-gray-500">Runtime</dt><dd>{d().platform.runtime} {d().platform.runtimeVersion}{d().platform.nodeVersion ? ` (node ${d().platform.nodeVersion})` : ''}</dd></div>
            </dl>
          </section>

          <section>
            <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">CPU</h3>
            <dl class="space-y-1 text-sm">
              <div class="flex gap-3"><dt class="w-24 text-gray-500">Model</dt><dd>{d().cpu.model}</dd></div>
              <div class="flex gap-3"><dt class="w-24 text-gray-500">Cores</dt><dd>{d().cpu.cores}</dd></div>
            </dl>
          </section>

          <section>
            <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Memory</h3>
            <dl class="space-y-1 text-sm">
              <div class="flex gap-3"><dt class="w-24 text-gray-500">Total</dt><dd>{d().memory.total}</dd></div>
              <div class="flex gap-3"><dt class="w-24 text-gray-500">Free</dt><dd>{d().memory.free}</dd></div>
              <div class="flex gap-3"><dt class="w-24 text-gray-500">Heap</dt><dd>{d().memory.processHeapUsed}</dd></div>
            </dl>
          </section>

          {d().gpu.length > 0 && (
            <section>
              <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">GPU{d().gpu.length > 1 ? 's' : ''}</h3>
              <div class="space-y-2">
                {d().gpu.map((gpu) => (
                  <div class="rounded-lg border border-gray-700 p-3 text-sm">
                    <div class="font-medium">{gpu.name}</div>
                    <div class="flex gap-4 mt-1 text-gray-400">
                      {gpu.vram.total && <span>VRAM: {gpu.vram.total} GB</span>}
                      <span>Driver: {gpu.driverVersion}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">ONNX Runtime</h3>
            <dl class="space-y-1 text-sm">
              <div class="flex gap-3"><dt class="w-24 text-gray-500">Version</dt><dd>{d().ort.version}</dd></div>
              <div class="flex gap-3"><dt class="w-24 text-gray-500">Backends</dt><dd>{d().ort.backends.map(b => b.name).join(', ') || 'none'}</dd></div>
            </dl>
          </section>
        </>
        )}
      </Show>

    </div>
  );
}
