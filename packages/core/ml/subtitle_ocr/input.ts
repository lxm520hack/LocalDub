import { z } from "zod";

export const MergeFramesArgsSchema = z.object({
  mergeSubstring: z.boolean().default(false).optional(),
  dedupLevenshtein: z.number().default(1).describe('dedupOverlap 的编辑距离阈值: levenshtein ≤ 此值则合并; 默认 1').optional(),
})
export type MergeFramesArgs = z.output<typeof MergeFramesArgsSchema>;