import type { TTSBackend, VoxCPMNodeConfig, VoxCPMPythonConfig, VoxCPMCloudConfig } from '../../types.ts';
import { VoxCPMBackend } from '../../types.ts';
import { VoxCPMNodeONNX } from './onnx-node.ts';
import { VoxCPMPython } from './pth.ts';
import { VoxCPMCloud } from './cloud.ts';

export { VoxCPMNodeONNX, checkONNXStatus, checkONNXReady } from './onnx-node.ts';
export { VoxCPMPython } from './pth.ts';
export { VoxCPMCloud } from './cloud.ts';

export type { TTSBackend, VoxCPMNodeConfig, VoxCPMPythonConfig, VoxCPMCloudConfig };

export function createVoxCPM(backend: VoxCPMBackend, config?: VoxCPMNodeConfig | VoxCPMPythonConfig | VoxCPMCloudConfig): TTSBackend {
  switch (backend) {
    case VoxCPMBackend.PYTORCH:
      return new VoxCPMPython(config as VoxCPMPythonConfig);
    case VoxCPMBackend.CLOUD:
      return new VoxCPMCloud(config as VoxCPMCloudConfig);
    case VoxCPMBackend.ORT:
    default:
      return new VoxCPMNodeONNX(config as VoxCPMNodeConfig);
  }
}
