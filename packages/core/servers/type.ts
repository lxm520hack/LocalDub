export const serverTypeList = [ 'voxcpm_torch_gradio', 'torch',] as const;
export type ServerType = (typeof serverTypeList)[number];

export type ModelStatus = {
  status: 'ready' | 'loading' | 'error' | 'unloaded' | 'timeout'
  device: string;
}
export type ModelServerStatus = {
  status: 'running' | 'stopped' | 'error' | 'timeout'
  port: number;
  uptime_s: number;
  models: {
    [modelName: string]: ModelStatus;
  };
  message?: string;
}