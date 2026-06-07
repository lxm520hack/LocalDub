## VAE 是什么

**VAE = Variational Autoencoder（变分自编码器）**，是一种生成模型，结构分为两部分：

```
输入数据 (如图像)
    ↓
[ Encoder / 编码器 ] → 学习数据的潜在表示 (latent space / 隐空间)
    ↓
[ Decoder / 解码器 ] → 从潜在表示重建原始数据
    ↓
输出 (重建的图像)
```

## VAE Encoder 的作用

| 功能 | 说明 |
|------|------|
| **压缩** | 把高维输入（如 512×512×3 的图像）压缩成低维的 **latent vector**（如 64×64×4） |
| **学习分布** | 不是直接输出一个固定向量，而是输出 **均值 μ 和对数方差 log(σ²)**，定义一个概率分布 |
| **采样** | 从这个分布中采样得到 latent code，引入随机性，让模型能生成多样内容 |

## 为什么 Stable Diffusion 里常提到 VAE Encoder/Decoder

Stable Diffusion 的完整流程：

```
文本提示
    ↓
[ CLIP Text Encoder ] → 文本特征
                        ↓
随机噪声 + 文本特征 → [ U-Net / Diffusion Model ] 逐步去噪
                        ↓
                     latent 表示 (64×64×4)
                        ↓
                [ VAE Decoder ] → 解码成真实图像 (512×512×3)
```

**关键点：**
- **训练时**：VAE Encoder 把训练图片压缩成 latent，U-Net 学习在这个压缩空间里做扩散
- **推理时**：不需要 Encoder，U-Net 生成 latent 后，直接用 **VAE Decoder** 解码成图像
- 所以 Stable Diffusion 的推理主要用 **VAE Decoder**，Encoder 只在训练或 img2img 时用

## 你的场景（AMD iGPU 推理）

如果你在用 Stable Diffusion 本地推理：
- **文生图 (txt2img)**：只用 VAE **Decoder**，不需要 Encoder
- **图生图 (img2img)**：需要 VAE **Encoder** 先把输入图片压缩成 latent，再走 U-Net

这意味着：
- img2img 比 txt2img **更吃显存**，因为要多一步编码
- 你的 AMD iGPU 共享显存有限，img2img 更容易爆显存

## 总结

> **VAE Encoder** 负责把图像/数据压缩进隐空间，**VAE Decoder** 负责从隐空间重建图像。  
> 在 Stable Diffusion 推理中，txt2img 主要用 Decoder；img2img 需要 Encoder + Decoder，对显存更敏感。

