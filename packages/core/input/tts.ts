import { z } from "zod";

export const TTSTaskInputSchema = z.object({
	runtime: z.enum(['ggml', 'pytorch', 'ort', 'cloud', 'voxcpm_torch_gradio']).default('pytorch').optional(),
	device: z.enum(['webgpu', 'cuda', 'rocm', 'cpu', 'mps']).default('cuda').optional(),
	skipExisting: z.boolean().default(false).optional(),
})
	.default({
		runtime: 'pytorch',
		device: 'cuda',
		skipExisting: true,
	})
	.optional().describe(`input: 1. metadata/translation.{lang}.json: translation[i].dst
		2. segments/vocals/{0001..N}.wav
		output: segments/tts/{0001..N}.wav`);
export type TTSInput = z.output<typeof TTSTaskInputSchema>;
