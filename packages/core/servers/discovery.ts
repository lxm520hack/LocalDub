/** mDNS service discovery for LocalDub servers.

Server types:
  - `torch`              → pytorch_server.py (ASR + separate)  → default port 19109
  - `voxcpm_torch_gradio` → voxcpm_torch_server/server.py (TTS) → default port 19112

Usage:
  ```ts
  import { findServer, findServers } from '@repo/core/servers/discovery'

  // Get the first discovered (or fallback) server
  const { port, host } = await findServer('torch', 19109)

  // Get all discovered servers as base URLs
  const urls = await findServers('torch', 19109)
  ```
*/

import { ServerType } from '@repo/core/servers/type';

export interface ServerInfo {
  host: string
  port: number
  foundVia: 'mdns' | 'default' | 'portfile'
}

const SERVICE_MAP: Record<ServerType, string> = {
  voxcpm_torch_gradio: '_localdub-voxcpm._tcp',
  torch: '_localdub-torch._tcp',
}

/** Timeout for mDNS browse (ms). */
const MDNS_TIMEOUT = 3000


/**
 * Discover all running instances of a server type via mDNS.
 * Falls back to a single default entry if nothing found.
 *
 * Returns base URLs like `http://127.0.0.1:19109`.
 */
export async function findServers(
  type: ServerType,
  defaultPort = type === 'torch' ? 19109 : 19112,
  defaultHost = '127.0.0.1',
): Promise<string[]> {
  const mdnsList = await findServerViaMdnsAll(type, MDNS_TIMEOUT)
  if (mdnsList.length > 0) {
    return mdnsList.map((s) => `http://${s.host}:${s.port}`)
  }
  return [`http://${defaultHost}:${defaultPort}`]
}

/**
 * Discover a single LocalDub server by mDNS, falling back to default port.
 */
export async function findServer(
  type: ServerType,
  defaultPort = type === 'torch' ? 19109 : 19112,
  defaultHost = '127.0.0.1',
): Promise<ServerInfo> {
  const mdnsList = await findServerViaMdnsAll(type, MDNS_TIMEOUT)
  if (mdnsList.length > 0) {
    return { ...mdnsList[0], foundVia: 'mdns' }
  }
  return { host: defaultHost, port: defaultPort, foundVia: 'default' }
}

export async function findServerViaMdnsAll(
  type: ServerType,
  timeoutMs: number=MDNS_TIMEOUT,
): Promise<{ host: string; port: number }[]> {
  const serviceType = SERVICE_MAP[type]
  if (!serviceType) return []

  const Bonjour = await import('bonjour-service').then((m) => m.Bonjour)
  const bonjour = new Bonjour()
  const results: { host: string; port: number }[] = []

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      browser.stop()
      bonjour.destroy()
      resolve(results)
    }, timeoutMs)

    const browser = bonjour.find({ type: serviceType.replace(/^_|\._tcp$/g, '') }, (svc) => {
      const entry = { host: svc.referer?.address ?? '127.0.0.1', port: svc.port }
      // Deduplicate
      if (!results.some((r) => r.host === entry.host && r.port === entry.port)) {
        results.push(entry)
      }
    })

    browser.start()
  })
}

/** Read the first PORT= line from a spawned process stdout. */
export function readPortFromOutput(output: string, defaultPort: number): number {
  const m = output.match(/^PORT=(\d+)/m)
  return m ? parseInt(m[1], 10) : defaultPort
}
