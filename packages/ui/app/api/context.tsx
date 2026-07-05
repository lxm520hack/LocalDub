import { createContext, useContext } from 'solid-js';
import type { ModelServerStatus, ModelStatus } from '@repo/core/servers/type';
import type { DeviceInfo } from '@repo/device';
import { GroupInfo } from '@repo/core/cmd/tasks/get_group_list';
export type { DeviceInfo, ModelServerStatus, ModelStatus };

export interface ServersManagerApi {
  startTorch: () => Promise<ModelServerStatus>;
  stopTorch: () => Promise<ModelServerStatus>;
  restartTorch: () => Promise<ModelServerStatus>;
  checkTorch: () => Promise<ModelServerStatus>;
  startVoxCpm: () => Promise<ModelServerStatus>;
  stopVoxCpm: () => Promise<ModelServerStatus>;
  restartVoxCpm: () => Promise<ModelServerStatus>;
  checkVoxCpm: () => Promise<ModelServerStatus>;
}

export interface ClientApi {
  serversManagerApi?: ServersManagerApi;
  deviceInfoApi?: { fetchDeviceInfo: () => Promise<DeviceInfo> };
  inputEditorApi?: {
    readInput: () => Promise<string>;
    writeInput: (content: string) => Promise<void>;
    readInputSchema: () => Promise<string>;
  };
  taskApi?: {
    getGroupList: () => Promise<GroupInfo[]>;
  }
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
