import { createContext, useContext } from 'solid-js';
import type { DeviceInfo } from '@repo/device';
export type { DeviceInfo };

export interface TorchStatus {
  running: boolean;
  uptime_s: number;
  models: Record<string, boolean>;
}

export interface ServersManagerApi {
  startTorch: () => Promise<TorchStatus>;
  stopTorch: () => Promise<TorchStatus>;
  restartTorch: () => Promise<TorchStatus>;
}

export interface ClientApi {
  serversManagerApi?: ServersManagerApi;
  deviceInfoApi?: { fetchDeviceInfo: () => Promise<DeviceInfo> };
  inputEditorApi?: {
    readInput: () => Promise<string>;
    writeInput: (content: string) => Promise<void>;
    readInputSchema: () => Promise<string>;
  };
}

const ClientApiCtx = createContext<ClientApi>({});

export function ClientApiProvider(props: { value: ClientApi; children: any }) {
  return (
    <ClientApiCtx.Provider value={props.value}>
      {props.children}
    </ClientApiCtx.Provider>
  );
}

export function useClientApi() {
  return useContext(ClientApiCtx);
}
