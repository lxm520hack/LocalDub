import { client } from '#/lib/rspc.ts';
import type { DeviceInfo } from '@repo/ui';

export async function fetchDeviceInfo(): Promise<DeviceInfo> {
  return await client.query(['deviceInfo', null])
}
