import { createClient, FetchTransport } from '@rspc/client'
import { TauriTransport } from '@rspc/tauri'
import { isTauri } from '@tauri-apps/api/core'
import type { ProceduresLegacy } from './bindings'

const transport = isTauri()
  ? new TauriTransport()
  : new FetchTransport('http://localhost:19110/rspc')

export const client = createClient<ProceduresLegacy>({ transport })
