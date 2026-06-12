# Skip translate via `stages.translate.enabled: false`

## 概念

`translate` 阶段增加 `enabled` 参数。设为 `false` 时：
- pipeline 不包含 `translate` 阶段
- `split_audio` 和 `merge_video` 直接用 srt.json 的原始文本

## 改动清单

### 1. `packages/cli/src/feat/config/types.ts` — TranslateConfigSchema 加 enabled

```typescript
const TranslateConfigSchema = z
	.looseObject({
		apiBase: z.string().optional(),
		model: z.string().optional(),
		targetLang: z
			.enum(targetLangList)
			.optional()
			.describe('如果不填则 按照这个逻辑: 源语言: zh -> en, 否则 any -> zh'),
		enabled: z
			.boolean()
			.optional()
			.describe('设为 false 跳过翻译，直接使用原始识别文本'),
	})
	.optional();
```

### 2. `packages/cli/config.schema.json` — translate 属性加 enabled

在 translate properties 里加：
```json
"enabled": {
  "description": "设为 false 跳过翻译，直接使用原始识别文本",
  "type": "boolean"
}
```

### 3. `packages/cli/src/feat/tasks/stages.ts` — getStages() 过滤 translate

```typescript
export function getStages(pipeline?: string): StageSpec[] {
  const stages = pipeline === 'subtitle' ? SUBTITLE_STAGES : DUB_STAGES;
  try {
    const cfg = readConfig();
    const src = cfg.subtitleSource ?? 'asr';
    if (src === 'ocr') {
      stages = withOcr(stages, pipeline);
    }
    // 新增：enabled === false 时移除 translate
    if (cfg.stages?.translate?.enabled === false) {
      stages = stages.filter(s => s.name !== 'translate');
    }
  } catch {
    // config may not be available (e.g. import time); use default
  }
  return stages;
}
```

### 4. `packages/cli/src/feat/tasks/pipeline-runner.ts` — snapshotConfig 捕获 enabled

在 translate 的 snapshot 块加：
```typescript
const tr = cfg.stages?.translate;
if (tr) {
  snap.stages.translate = {
    apiBase: tr.apiBase,
    model: tr.model,
    targetLang: tr.targetLang,
    enabled: tr.enabled,
  };
}
```

### 5. `packages/cli/src/feat/stages/split_audio.ts` — 无 translation 时 fallback

当前行 70 和 83-87 硬性需要 translation.json。改成：

```typescript
const transData = existsSync(translationFile)
  ? readJson(translationFile, 'split_audio', taskId)
  : { translation: segmentsSrc.map(s => ({
      src: s.text,
      dst: s.text,
      src_lang: srcLangCode,
      dst_lang: srcLangCode,
      speaker: '1',
    })) };
const translation = transData.translation;
```

其中 `srcLangCode` 从 `readTaskLanguages(sessionPath)` 获取（已在顶部 import）。

### 6. `packages/cli/src/feat/stages/merge_video.ts` — 字幕分支 fallback 到 srt.json

当前行 246-250：
```typescript
const srcFile = existsSync(timingsFile) ? timingsFile : translationFile;
if (!existsSync(srcFile))
  throw new Error(`neither timings.json nor translation.${dstLangCode}.json found`);
const data = readJson(srcFile, 'Merge Video');
```

改成三级 fallback：
```typescript
const srtFile = join(metadataDir, 'srt.json');
const srcFile = existsSync(timingsFile) ? timingsFile
  : existsSync(translationFile) ? translationFile
  : srtFile;
if (!existsSync(srcFile))
  throw new Error(`no timings.json, translation.json, or srt.json found`);

let data: any;
if (srcFile === srtFile) {
  // Convert srt.json format to translation format
  const srt = readJson(srtFile, 'Merge Video');
  const segments = srt.result?.segments ?? [];
  data = {
    translation: segments.map((seg: any) => ({
      src: seg.text,
      dst: seg.text,
      start_time: Math.round(seg.start * 1000),
      end_time: Math.round(seg.end * 1000),
      speaker: '1',
    })),
  };
} else {
  data = readJson(srcFile, 'Merge Video');
}
const dstLang = dstLangFromTranslation(data.translation);
```

## 验证

```bash
cd packages/cli && npx tsx src/cli.ts startTask --pipeline subtitle --subtitleSource ocr --config '{"stages":{"translate":{"enabled":false}}}' <video>
```
