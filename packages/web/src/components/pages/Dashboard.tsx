import { createSignal, onMount, onCleanup } from 'solid-js';

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

export function Dashboard() {
  const [health, setHealth] = createSignal<HealthData | null>(null);
  const [logs, setLogs] = createSignal('');

  onMount(() => {
    let dead = false;

    async function fetchAll() {
      try {
        const [hRes, lRes] = await Promise.all([
          fetch('/api/health').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/logs?n=100').then((r) => (r.ok ? r.json() : null)),
        ]);
        if (dead) return;
        if (hRes) setHealth(hRes);
        if (lRes && lRes.lines != null) setLogs(lRes.lines);
      } catch {}
    }

    fetchAll();
    const id = setInterval(fetchAll, 3000);
    onCleanup(() => {
      dead = true;
      clearInterval(id);
    });
  });

  return (
    <div class="p-8 max-w-5xl mx-auto">
      <div class="flex items-center gap-3 mb-6">
        <div
          class="w-3 h-3 rounded-full shrink-0"
          style={{
            'background-color': health() ? '#22c55e' : '#ef4444',
          }}
        />
        <h1 class="text-2xl font-bold">Torch Server</h1>
        <span class="text-sm text-gray-500 ml-auto">
          {health()
            ? `uptime ${fmtUptime(health()!.uptime_s)}`
            : 'connecting...'}
        </span>
      </div>

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
