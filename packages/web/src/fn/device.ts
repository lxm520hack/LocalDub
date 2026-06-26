import { createServerFn } from '@tanstack/solid-start';
import type { DeviceInfo } from '@repo/device';

export const fetchDeviceInfo = createServerFn().handler(async (): Promise<DeviceInfo> => {
  const { getDeviceInfo } = await import('@repo/device');
  return getDeviceInfo();
});
