#!/usr/bin/env bun
import { join, resolve } from 'node:path';
import { existsSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';

const repoRoot = resolve(import.meta.dir, '..');
const WORKFOLDER = process.env['WORKFOLDER']
  ? resolve(repoRoot, process.env['WORKFOLDER'])
  : join(repoRoot, 'workfolder');

const SRC_SUFFIX = '_dub_asr_ocr.mp4';

function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const seriesName = args.find(a => !a.startsWith('--'));

  const localDir = join(WORKFOLDER, 'local');
  if (!existsSync(localDir)) {
    console.error('workfolder/local/ 不存在');
    process.exit(1);
  }

  if (!seriesName) {
    const dirs = readdirSync(localDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    if (dirs.length === 0) {
      console.log('workfolder/local/ 下没有系列目录');
    } else {
      console.log('可导出的系列:');
      for (const dir of dirs) {
        const episodes = readdirSync(join(localDir, dir)).filter(n => /^\d+$/.test(n));
        console.log(`  ${dir} (${episodes.length} 集)`);
      }
    }
    return;
  }

  const seriesDir = join(localDir, seriesName);
  if (!existsSync(seriesDir)) {
    console.error(`系列目录不存在: ${seriesName}`);
    process.exit(1);
  }

  const episodeDirs = readdirSync(seriesDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d+$/.test(d.name))
    .map(d => parseInt(d.name, 10))
    .sort((a, b) => a - b);

  if (episodeDirs.length === 0) {
    console.log(`"${seriesName}" 下没有剧集目录`);
    return;
  }

  const outDir = join(WORKFOLDER, 'out', seriesName);
  mkdirSync(outDir, { recursive: true });

  let copied = 0, skipped = 0, failed = 0;

  for (const ep of episodeDirs) {
    const src = join(seriesDir, String(ep), 'media', `${ep}${SRC_SUFFIX}`);
    const dst = join(outDir, `${ep}.mp4`);

    if (!existsSync(src)) {
      console.log(`  ✗ 第 ${ep} 集: 源文件缺失`);
      failed++;
      continue;
    }

    if (existsSync(dst) && !force) {
      console.log(`  · 第 ${ep} 集: 已存在, 跳过`);
      skipped++;
      continue;
    }

    copyFileSync(src, dst);
    console.log(`  ✓ 第 ${ep} 集 → workfolder/out/${seriesName}/${ep}.mp4`);
    copied++;
  }

  console.log(`\n完成: ${copied} 复制, ${skipped} 跳过, ${failed} 失败`);
}

main();
