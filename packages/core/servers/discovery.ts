/** mDNS service discovery for LocalDub servers.

Server types:
  - `torch`              → pytorch_server.py (ASR + separate)  → default port 19109
  - `voxcpm_torch_gradio` → voxcpm_torch_server/server.py (TTS) → default port 19112

Usage:
  ```ts
  import { findServer } from '@repo/config/discovery'
  const { port, host } = await findServer('torch', 19109)
  ```
*/

export interface ServerInfo {
  host: string
  port: number
  foundVia: 'mdns' | 'default' | 'portfile'
}

const SERVICE_MAP: Record<string, string> = {
  torch: '_localdub-torch._tcp',
  voxcpm_torch_gradio: '_localdub-voxcpm._tcp',
}

/** Timeout for mDNS browse (ms). */
const MDNS_TIMEOUT = 3000

/**
 * Discover a LocalDub server by mDNS, falling back to default port.
 *
 * @param type  Server type (`"torch"` or `"voxcpm_torch_gradio"`)
 * @param defaultPort  Fallback port if mDNS fails
 * @param defaultHost  Host to check for fallback
 */
export async function findServer(
  type: 'voxcpm_torch_gradio' | 'torch',
  defaultPort = type === 'torch' ? 19109 : 19112,
  defaultHost = '127.0.0.1',
): Promise<ServerInfo> {
  // 1) Try mDNS
  try {
    const mdns = await findServerViaMdns(type, MDNS_TIMEOUT)
    if (mdns) return { ...mdns, foundVia: 'mdns' }
  } catch {
    // fall through
  }

  // 2) Fallback: check default port
  return { host: defaultHost, port: defaultPort, foundVia: 'default' }
}

async function findServerViaMdns(
  type: string,
  timeoutMs: number,
): Promise<{ host: string; port: number } | null> {
  const serviceType = SERVICE_MAP[type]
  if (!serviceType) return null

  // Dynamic import so bundlers don't choke on Node.js modules
  const Bonjour = await import('bonjour-service').then((m) => m.Bonjour)
  const bonjour = new Bonjour()

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      bonjour.destroy()
      resolve(null)
    }, timeoutMs)

    const browser = bonjour.find({ type: serviceType.replace(/^_|\._tcp$/g, '') }, (svc) => {
      clearTimeout(timer)
      browser.stop()
      bonjour.destroy()
      resolve({ host: svc.referer?.address ?? '127.0.0.1', port: svc.port })
    })

    browser.start()
  })
}

/**
 * Read the first PORT= line from a spawned process stdout.
 */
export function readPortFromOutput(output: string, defaultPort: number): number {
  const m = output.match(/^PORT=(\d+)/m)
  return m ? parseInt(m[1], 10) : defaultPort
}
