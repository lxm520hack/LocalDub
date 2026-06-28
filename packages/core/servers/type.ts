export type ModelStatus = {
  status: 'ready' | 'loading' | 'error' | 'unloaded';
  device: string;
}
export type ModelServerStatus = {
  status: 'running' | 'stopped' | 'error';
  port: number;
  uptime_s: number;
  models: {
    [modelName: string]: ModelStatus;
  };
  message?: string;
}