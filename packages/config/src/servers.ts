export const serverTypeList = [ 'voxcpm_torch_gradio', 'demucs_torch_server',] as const;
export type ServerType = (typeof serverTypeList)[number];

export const SERVICE_MAP: Record<ServerType, string> = {
  voxcpm_torch_gradio: '_localdub-voxcpm._tcp.local',
  demucs_torch_server: '_localdub-torch._tcp.local',
}
