import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkONNX } from './onnx-cpu';
import { benchmarkPyTorch } from './pytorch-cpu';
import { printSummary, RESULTS_DIR, type BenchmarkResult } from './bench-shared';

async function main() {
  const all: BenchmarkResult[] = [];

  console.log('=== Demucs Separation Benchmark ===\n');

  console.log('--- PyTorch CPU ---');
  const pytorchResults = await benchmarkPyTorch();
  all.push(...pytorchResults);

  console.log('\n--- ONNX CPU ---');
  const onnxResults = await benchmarkONNX();
  all.push(...onnxResults);

  printSummary(all);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const path = join(RESULTS_DIR, 'separate-bench.json');
  writeFileSync(path, JSON.stringify(all, null, 2));
  console.log(`\nResults saved to ${path}`);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
