import { createContext, useContext } from 'solid-js';
import type { ModelServerStatus, ModelStatus } from '@repo/core/servers/type';
import type { DeviceInfo } from '@repo/device';
export type { DeviceInfo, ModelServerStatus, ModelStatus };

export type TorchStatus = ModelServerStatus;

export interface VoxCpmStatus {
  running: boolean;
  model_loaded: boolean;
  model_status: string;
  model_device: string;
}

export interface ServersManagerApi {
  startTorch: () => Promise<TorchStatus>;
  stopTorch: () => Promise<TorchStatus>;
  restartTorch: () => Promise<TorchStatus>;
  checkTorch: () => Promise<TorchStatus>;
  startVoxCpm: () => Promise<VoxCpmStatus>;
  stopVoxCpm: () => Promise<VoxCpmStatus>;
  restartVoxCpm: () => Promise<VoxCpmStatus>;
  checkVoxCpm: () => Promise<VoxCpmStatus>;
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
