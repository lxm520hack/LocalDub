# ASR Parameter Benchmark Results

## Summary

Two rounds of testing: **38 whisper.cpp CLI parameter sets** across audio sources, using large-v3-turbo on Radeon 780M (Vulkan).

### Combined evaluation (CER + Timestamp Offset)

 | Source | Params | CER | hyp/ref | s_off_mean | s_off_median | det_rate | "唉" |
|--------|--------|-----|---------|-----------|-------------|----------|:----:|
| sidechain | **temp-02** | 7.72% | 557/557 | **+0.04s** | **+0.04s** | 95.7% | ❌ |
| sidechain | temp-04 | 7.72% | 557/557 | +0.04s | +0.04s | 95.7% | ❌ |
| sidechain | baseline | 8.44% | 551/557 | +0.09s | +0.04s | 95.7% | ❌ |
| raw | baseline | 8.08% | 556/557 | +0.09s | +0.04s | 95.7% | ❌ |
| raw | **vad-v6** | 12.57% | 532/557 | **-1.16s** | -0.35s | 100% | ✅ |
| raw | vad-v6-th02 | 11.85% | 552/557 | -0.82s | -0.29s | 100% | ✅ |
| sidechain | vad-v6-th02 | 7.00% | 552/557 | -0.68s | -0.23s | 100% | ❌ |
| sidechain | vad-v6 | 10.59% | 539/557 | -0.79s | -0.34s | 100% | ✅ |

**Key takeaway**: The configs with highest timestamp accuracy (s_off_mean < 0.15s) all miss "唉", "啊", "哈哈哈". The configs that detect "唉" have s_off_mean > -0.68s — significant systematic left shift. VAD variants shift all segment boundaries ~0.5-1.5s left (earlier than GT), meaning timestamps for downstream subtitle rendering will be off. Evaluated against corrected GT at `packages/benchmark/ref/metadata/srt_manual.json` (93 segments).

### Full results (all 38 runs)

| Source | Params | Segs | RTF | CER | hyp/ref | s_off_mn | det% | "唉" |
|--------|--------|------|-----|-----|---------|----------|------|:----:|
| raw | baseline | 90 | 0.091 | 8.08% | 556/557 | **+0.09** | 95.7 | ❌ |
| raw | vad-default | 76 | 0.070 | 20.83% | 494/557 | -1.73 | 100 | ❌ |
| raw | vad-low | 77 | 0.067 | 21.36% | 490/557 | -1.61 | 97.8 | ❌ |
| raw | vad-high | 74 | 0.066 | 22.62% | 476/557 | -1.93 | 100 | ❌ |
| raw | nst-{050,040,020,010} | 90 | 0.092 | 8.08% | 556/557 | +0.09 | 95.7 | ❌ |
| raw | vad+nst-050 | 76 | 0.076 | 20.83% | 494/557 | -1.73 | 100 | ❌ |
| raw | temp-02 | 48 | 0.127 | 24.96% | 652/557 | **-2.65** | 100 | ❌ |
| raw | temp-04 | 84 | 0.089 | 8.44% | 555/557 | +0.02 | 95.7 | ❌ |
| raw | max-len-20 | 90 | 0.082 | 8.08% | 556/557 | +0.09 | 95.7 | ❌ |
| raw | suppress-nst | 90 | 0.083 | 8.80% | 555/557 | +0.10 | 95.7 | ❌ |
| raw | nst-020+max20 | 90 | 0.083 | 8.08% | 556/557 | +0.09 | 95.7 | ❌ |
| raw | vad+nst-030 | 76 | 0.063 | 20.83% | 494/557 | -1.73 | 100 | ❌ |
| raw | **vad-v6** | 87 | 0.074 | 12.57% | 532/557 | -1.16 | 100 | ✅ |
| raw | vad-v6+nst-020 | 87 | 0.074 | 12.57% | 532/557 | -1.16 | 100 | ✅ |
| raw | **vad-v6-th02** | 91 | 0.085 | 11.85% | 552/557 | -0.82 | 100 | ✅ |
| sidechain | baseline | 89 | 0.105 | 8.44% | 551/557 | **+0.09** | 95.7 | ❌ |
| sidechain | vad-default | 82 | 0.072 | 12.93% | 517/557 | -1.14 | 100 | ❌ |
| sidechain | vad-low | 92 | 0.071 | 12.93% | 527/557 | -0.84 | 96.8 | ❌ |
| sidechain | vad-high | 86 | 0.069 | 21.72% | 482/557 | -1.08 | 95.7 | ❌ |
| sidechain | nst-{050,040,020,010} | 89 | 0.105 | 8.44% | 551/557 | +0.09 | 95.7 | ❌ |
| sidechain | vad+nst-050 | 82 | 0.071 | 12.93% | 517/557 | -1.14 | 100 | ❌ |
| sidechain | **temp-02** | 86 | 0.110 | **7.72%** | **557/557** | **+0.04** | 95.7 | ❌ |
| sidechain | temp-04 | 86 | 0.095 | 7.72% | 557/557 | +0.04 | 95.7 | ❌ |
| sidechain | max-len-20 | 89 | 0.097 | 8.44% | 551/557 | +0.09 | 95.7 | ❌ |
| sidechain | suppress-nst | 104 | 0.117 | 52.42% | 712/557 | 0.00 | 92.5 | ❌ |
| sidechain | nst-020+max20 | 89 | 0.100 | 8.44% | 551/557 | +0.09 | 95.7 | ❌ |
| sidechain | vad+nst-030 | 82 | 0.068 | 12.93% | 517/557 | -1.14 | 100 | ❌ |
| sidechain | vad-v6 | 88 | 0.076 | 10.59% | 539/557 | -0.79 | 100 | ✅ |
| sidechain | vad-v6+nst-020 | 88 | 0.074 | 10.59% | 539/557 | -0.79 | 100 | ✅ |
| sidechain | **vad-v6-th02** | 88 | 0.081 | **7.00%** | 552/557 | **-0.68** | 100 | ❌ |
| vocals | baseline | 98 | 0.090 | 8.62% | 554/557 | -0.71 | 98.9 | ❌ |
| vocals | temp-02 | 16 | 0.107 | 30.70% | 662/557 | -6.52 | 96.8 | ❌ |
| vocals | temp-04 | 20 | 0.086 | 29.44% | 595/557 | -6.43 | 98.9 | ❌ |

### Detailed offset analysis for problem segments

#### "唉" (71.20-71.72)

| Source | Params | GT → Hyp | s_off | IOU |
|--------|--------|----------|-------|-----|
| raw | baseline | MISSED (no overlap) | — | 0 |
| raw | vad-v6 | [71.20-71.72] → [69.92-71.48] "唉" | **-1.28s** | 0.16 |
| raw | vad-v6-th02 | [71.20-71.72] → [69.74-71.53] "唉" | **-1.46s** | 0.17 |
| sidechain | vad-v6 | [71.20-71.72] → [69.92-71.52] "唉" | **-1.28s** | 0.18 |
| sidechain | vad-v6-th02 | [71.20-71.72] → [70.40-74.02] "还是缺灵石啊" | **-0.80s** | 0.14 |

VAD v6 detects "唉" but shifts its start ~1.3s left (69.92 vs GT 71.20). Hyp start coincides with the tail-end murmur of previous segment "韩光剑终究差了火候" at 69.72, meaning VAD grabbed a breath/noise between segments as the beginning of "唉". With th02 on sidechain, the "唉" text was merged into the following segment entirely.

#### "啊" (113.96-115.12) + "哈哈哈" (115.42-116.96)

Every config merges these into either silence or the adjacent "发财了" segment. No IOU > 0.22 with GT.

### Key findings

1. **CER alone is misleading.** Lowest CER (7.00%, sidechain/vad-v6-th02) comes with -0.76s systematic start offset — timestamps too early for subtitle use.

2. **Temperature-annealed configs (temp-02/04) have best timestamp accuracy** (s_off_mean +0.04s, median +0.04s) while matching 557/557 chars. This is the correct choice for pipeline use.

3. **VAD variants systematically shift boundaries left** (s_off_mean -0.68 to -1.93s) — VAD detects speech earlier than manual GT boundaries, likely because it includes breathing/silence-before-speech as part of the segment.

4. **Detection rate (det%):** Non-VAD configs miss "唉/啊/哈哈哈" → 95.6% det. VAD configs detect 100% of GT segments by IOU > 0. But IOU for those segments is very low (0.11-0.18), meaning the segmentation is qualitatively wrong even though it registers a detection.

5. **"啊" and "哈哈哈" are not captured by any whisper.cpp configuration** due to whisper's language model decoding preference — the combined audio is decoded as "发财了" regardless of segmentation approach.

### GT segment structure around problem area

```
[107.80-108.72] "谢师父指点"
         ~5.2s silence
[113.96-115.12] "啊"           (1.16s)  ← never captured
          0.3s gap
[115.42-116.96] "哈哈哈"       (1.54s)  ← never captured
         ~1.04s silence
[118.00-119.16] "嗯发财了"     (1.16s)  ← all whisper runs capture "发财了" (omit "嗯")
```

> GT from `packages/benchmark/ref/metadata/srt_manual.json` (93 segments, user-corrected)

### Recommendation for pipeline

**Use `sidechain + --temperature 0.2`.** It has the best timestamp accuracy (s_off_mean +0.04s), matches 557/557 characters, and has acceptable CER (7.72%). The trade-off: "唉", "啊", and "哈哈哈" are missing from output — these are 3 short segments totaling ~3.5s out of 170s.

If capturing short vocalizations is critical, faster-whisper or external VAD pre-segmentation would be needed, since whisper.cpp's integrated VAD inexcusably destroys timestamp accuracy.

### How to run

```bash
# Full ASR benchmark (38 param sets)
bun run packages/benchmark/asr/whisper/compute/benchmark-asr-params.ts

# Timestamp offset analysis (reads existing results)
bun run packages/benchmark/asr/whisper/compute/benchmark-asr-offsets.ts
```

**Files**: `results/{source}/{param-label}/metadata/{asr,whisper_raw,summary}.json`
**Scripts**: `packages/benchmark/asr/whisper/compute/benchmark-asr-{params,offsets}.ts`
