import { invoke } from './invoke';
import type { DeviceInfo } from '@repo/ui';

export async function fetchDeviceInfo(): Promise<DeviceInfo> {
  const raw = await invoke<string>('device_info');
  return JSON.parse(raw) as DeviceInfo;
}
