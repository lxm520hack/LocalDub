import { ModelServerStatus } from "@repo/core/servers/type";

export const fetchStatsRes = (port: number) => fetch(`http://127.0.0.1:${port}/status`, {
  signal: AbortSignal.timeout(2000),
})

export const fetchStatsData = async (port: number): Promise<ModelServerStatus> => {
  const res = await fetchStatsRes(port);
  if (!res.ok) throw new Error(`Failed to fetch status from port ${port}: ${res.status}`);
  return await res.json() as ModelServerStatus;
}