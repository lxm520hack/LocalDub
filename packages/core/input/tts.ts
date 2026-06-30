import { z } from "zod";

export const TtsStageInputSchema = z.object({
	runtime: z.enum(['ggml', 'pytorch', 'ort', 'cloud', 'voxcpm_torch_gradio']).default('pytorch').optional(),
	device: z.enum(['webgpu', 'cuda', 'rocm', 'cpu', 'mps']).default('cuda').optional(),
	skipExisting: z.boolean().default(true).optional(),
	onlyIndices: z.array(z.number().int().positive()).optional().describe('仅处理指定索引的 segment（其余跳过），可用于精准重跑指定段'),
})
	.default({
		runtime: 'pytorch',
		device: 'cuda',
		skipExisting: true,
	})
	.optional().describe(`input: 1. split_audio/timings.json: translation[i].dst`);
export type TTSInput = z.output<typeof TtsStageInputSchema>;
