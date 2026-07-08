export const serverTypeList = [ 'voxcpm_torch_gradio', 'demucs_torch_server',] as const;
export type ServerType = (typeof serverTypeList)[number];

export const SERVICE_MAP: Record<ServerType, string> = {
  voxcpm_torch_gradio: '_ld-voxcpm-py._tcp.local',
  demucs_torch_server: '_ld-demucs-py._tcp.local',
}
