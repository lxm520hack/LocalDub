import { Client, createClient, FetchTransport } from '@rspc/client'
import { TauriTransport } from '@rspc/tauri'
import { isTauri } from '@tauri-apps/api/core'
import type { ProceduresLegacy } from './bindings'
import { createSolidQueryHooks } from '#/integrations/rspc/query.tsx';

const transport = isTauri()
  ? new TauriTransport()
  : new FetchTransport('http://localhost:19110/rspc')

export const client = createClient<ProceduresLegacy>({ transport })
export type RspcClient = Client<ProceduresLegacy>

export const rspc = createSolidQueryHooks<ProceduresLegacy>();
