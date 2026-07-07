import type { Client, OperationType, Transport } from '@rspc/client'
import { createClient, FetchTransport } from '@rspc/client'
import { TauriTransport } from '@rspc/tauri'
import { isTauri } from '@tauri-apps/api/core'
import type { ProceduresLegacy } from './bindings'
import { createSolidQueryHooks } from '#/integrations/rspc/query.tsx';

class LoggingTransport implements Transport {
  clientSubscriptionCallback?: Transport['clientSubscriptionCallback']

  constructor(
    private inner: Transport,
    private label: string,
  ) {
    this.clientSubscriptionCallback = inner.clientSubscriptionCallback
  }

  async doRequest(operation: OperationType, key: string, input: any) {
    const start = performance.now()
    console.log(`[RSPC ${this.label}] → ${operation} ${key}`, input ?? '')
    try {
      const result = await this.inner.doRequest(operation, key, input)
      const ms = (performance.now() - start).toFixed(1)
      console.log(`[RSPC ${this.label}] ← ${operation} ${key} (${ms}ms)`)
      return result
    } catch (error) {
      const ms = (performance.now() - start).toFixed(1)
      console.error(`[RSPC ${this.label}] ✗ ${operation} ${key} (${ms}ms)`, error)
      throw error
    }
  }
}

const isTauriEnv = isTauri()
const inner = isTauriEnv
  ? new TauriTransport()
  : new FetchTransport('http://localhost:19110/rspc')
const transport = new LoggingTransport(inner, isTauriEnv ? 'IPC' : 'HTTP')

export const client = createClient<ProceduresLegacy>({ transport })
export type RspcClient = Client<ProceduresLegacy>

export const rspc = createSolidQueryHooks<ProceduresLegacy>();
