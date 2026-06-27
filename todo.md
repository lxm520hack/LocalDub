## TODO

- 自动设备检测：目前 default `device: "cuda"` 在 ROCm 上可能 hang，待实现运行时可感知的自动检测
- ASR 参数基准测试完成：sidechain + vad-v6-th02 最佳 CER 8.41% 但 s_off -534ms；sidechain + temp-02 最佳 timing（CER 9.48%，s_off +203ms，94.7% 检测率）。详情 → `packages/benchmark/asr/whisper/results/FINDINGS.md`
- 归一化 CER 评估脚本完善（`eval-ocr.ts`）：数字归一化、同音词容差、段级偏移/检测率分析
- 2fps 固定采样的 `mergeFrames` empty-frame 间隔修复：空帧不再跳过而是结束当前段，防止段跨越无字幕间隙（"万一叶白忍不住宰了慧天怎么办" 从 9.5s 缩至 2s，匹配 GT）。修复后 end offset 从 +877ms 降至 +223ms。基准测试脚本：`packages/benchmark/ocr/compute/benchmark-cpp-fps.ts`
- CLI stage `ocr.ts` 已同步相同修复：空帧切段 + Levenshtein 合并
- **`select` 滤器替换 `fps` 滤器**：`ffmpeg -vf "select='not(mod(n,step))'"` 替代 `-vf fps=N`。根因：MP4 edit list 偏移 (1024 tbn ≈ 66.7ms) 导致 fps 滤器 PTS 对齐错位 → 帧索引错开，在 56.0s 过渡帧处只检出"身"而非"绝不起身"。select 滤器以帧索引对齐，不受 edit list 影响。包含 ffprobe 探测源帧率计算 step。
- **Substring 合并（第2轮）**：相邻两段若 Y 范围重叠且一段文本是另一段的子串，合并为长文本（消除 select 滤器仍可能产生的"身"+"绝不起身"对）
- **Triplet 合并（第3轮）**：A-B-C 模式（A≈C 文本，B ≤1000ms ≤2 字，Y 重叠）→ collapsing，消除 C++ ORT 单帧幻觉（"菌"在"嗯发财了"中间）
- **`box_y` 输出**：每段记录首个帧的 Y 轴边界 `[yMin, yMax]`
- **共享合并模块**：`packages/cli/src/feat/stages/utils/ocrMerge.ts` 导出 `FrameResult`、`Segment`、`levenshtein`、`mergeFrames`，CLI 和 benchmark 共用
