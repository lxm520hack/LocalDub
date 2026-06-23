# VSCode 视频预览/音频缓存 Bug

## 症状

- `audio_dubbing.wav` 播放正常
- `audio_mixed.m4a` 播放正常
- 最终 `*_dub.mp4` / `*_dub_asr_ocr.mp4` 某些音频段听不到

## 原因

VSCode 内置的视频预览插件（如 vscode-contribute-video-preview、vscode-media-preview 等）会对视频文件进行**音频缓存**。当重新编码生成新的 MP4 后，预览时可能播放的是**旧版本**的音频缓存，导致听到的内容与实际文件不一致。

## 排查

1. 用 VLC、ffplay 等外部播放器打开 MP4 确认是否真的缺少音频
2. 或用 `ffmpeg -i <file> -vn -acodec copy out.aac` 提取音频单独听
3. 在 VSCode 中 Ctrl+Shift+P → Developer: Reload Window 刷新插件缓存

## 解决

- 使用外部播放器（VLC、mpv、ffplay）验证最终文件
- 不要在 VSCode 内置预览中判断音频是否完整
