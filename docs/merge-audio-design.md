# merge_audio 设计演进

## Python 原版 (`backend/app/adapters/audio.py`)

```
TTS → audiostretchy (speed = base × localFactor) → 直接拼入 dubbing
```

- **无静音修剪**: TTS 输出带尾部静音一起拉伸
- **双层拉伸**:
  - `baseFactor = totalTarget / totalTTS × 0.99`, 钳位 [0.8, 1.2]
  - `localFactor = desiredSec / (currentSec × baseFactor)`, 钳位 [0.9, 1.1]
  - 最终 `speed = baseFactor × localFactor`, 有效范围 [0.72, 1.32]
- **速度公式**: `speed = desiredSec / currentSec` ❌ 反了
- **变速器**: `audiostretchy` (WSOLA 算法)
- **无中间文件**: 内存拉伸后直接拼入最终 dubbing

## TS 当前 (`packages/cli/src/feat/stages/merge_audio.ts`)

```
TTS → silenceremove → _trimmed.wav → rubberband (speed = trimmedSec / desiredSec) → stretched/{NNNN}.wav → concat → audio_dubbing.wav
```

- **有静音修剪**: `silenceremove stop_threshold=-50dB stop_duration=0.05`
- **无全局 baseFactor**
- **速度公式**: `speed = trimmedSec / desiredSec` ✅ 正确
- **变速器**: `rubberband` (比 atempo 音质好, 支持极端变速)
- **中间文件**: `stretched/{NNNN}_trimmed.wav` + `stretched/{NNNN}.wav`
- **无缓存**: 每次执行重建 (2025-06-07 改为无条件执行)

## 对比

| 方面 | Python 原版 | TS 当前 |
|------|:---:|:---:|
| 速度公式 | ❌ 反 (desired/current) | ✅ 正确 (trimmed/desired) |
| 修尾部静音 | ❌ 无 | ✅ silenceremove -50dB |
| 全局时长匹配 | ✅ baseFactor [0.8, 1.2] | ❌ 无 |
| 变速音质 | ⚠️ WSOLA | ✅ rubberband |
| 步骤 | 一步内存操作 | 两步 + 中间文件 |
| 钳位范围 | [0.72, 1.32] (太窄) | [0.25, 4.0] |
| 缓存策略 | 按文件存在性跳过 | 无缓存, 每次重建 |
| 输出格式 | 内存 → dubbing | 文件 → stretched/{N}.wav → concat → dubbing |

## 已知问题 (两代共有)

- 中间有空白时只插入静音, 不做交叉淡化
- BGM 音量固定 0.30, 无动态闪避
- 逐段独立拉伸, 段间可能有感知到的节奏不连续
