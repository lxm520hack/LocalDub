#!/usr/bin/env bun
import { getDeviceInfo } from './src/index.ts';

const info = await getDeviceInfo();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(info, null, 2));
  process.exit(0);
}

const formatGb = (v?: number) => (v != null ? `${v.toFixed(2)} GB` : 'N/A');

console.log('=== Device Info ===');
console.log(`OS:        ${info.platform.os} ${info.platform.arch}`);
console.log(`Host:      ${info.platform.hostname}`);
console.log(`Runtime:   ${info.platform.runtime} ${info.platform.runtimeVersion}`);
console.log(`CPU:       ${info.cpu.model} (${info.cpu.cores} cores)`);
console.log(`Memory:    ${info.memory.total} total, ${info.memory.free} free`);

console.log('\n=== GPU ===');
for (const gpu of info.gpu) {
  console.log(`  GPU:       ${gpu.name}`);
  console.log(`  Vendor:    ${gpu.vendor}`);
  console.log(`  Arch:      ${gpu.architecture ?? 'N/A'}`);
  console.log(`  Driver:    ${gpu.driverVersion}`);
  console.log(`  GFX Ver:   ${gpu.gfxVersion ?? 'N/A'}`);
  console.log(`  Temp:      ${gpu.temperature}°C`);
  console.log(`  GPU Load:  ${gpu.gpuPercent}%`);
  console.log(`  VRAM:      ${formatGb(gpu.vram.total)} used ${gpu.vram.percent}%`);
  if (gpu.vram.gtt != null) {
    console.log(`  GTT:       ${formatGb(gpu.vram.gtt)}`);
    console.log(`  Total Acc: ${formatGb((gpu.vram.total ?? 0) + gpu.vram.gtt)}`);
  }
  if (gpu.vulkanHeaps) {
    console.log(`  Vk DeviceLocal: ${gpu.vulkanHeaps.deviceLocal.toFixed(2)} GiB`);
    console.log(`  Vk HostVisible: ${gpu.vulkanHeaps.hostVisible.toFixed(2)} GiB`);
    console.log(`  Vk Total:       ${(gpu.vulkanHeaps.deviceLocal + gpu.vulkanHeaps.hostVisible).toFixed(2)} GiB`);
  }
  console.log(`  Type:      ${gpu.vram.type ?? 'N/A'}`);
  console.log(`  Caps:      ${Object.entries(gpu.capabilities).filter(([, v]) => v).map(([k]) => k).join(', ')}`);
  if (gpu.hsaOverrideGfx) console.log(`  HSA_OVERRIDE_GFX_VERSION: ${gpu.hsaOverrideGfx}`);
}

console.log('\n=== ONNX Runtime ===');
console.log(`  Version:   ${info.ort.version}`);
for (const b of info.ort.backends) {
  console.log(`  Backend:   ${b.name} (bundled: ${b.bundled})`);
}
