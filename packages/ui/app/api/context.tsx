import { createContext, useContext } from 'solid-js';

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
