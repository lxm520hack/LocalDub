export type ModelStatus = {
  status: 'ready' | 'loading' | 'error' | 'unloaded';
}
export type ModelServerStatus = {
  status: 'running' | 'stopped' | 'error';
  port: number;
  models: { // voxcpm, asr, separate, etc.
    [modelName: string]: ModelStatus;
  };
  message?: string;
}