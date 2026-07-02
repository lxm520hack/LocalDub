import { z } from "zod";

export const MergeFramesArgsSchema = z.object({
  mergeSubstring: z.boolean().default(false).optional(),
  dedupLevenshtein: z.number().default(1).describe('dedupOverlap 的编辑距离阈值: levenshtein ≤ 此值则合并; 默认 1').optional(),
})
export type MergeFramesArgs = z.output<typeof MergeFramesArgsSchema>;

export const LineAdjustedArgsSchema = z.object({
  lineAdjustedThreshold: z.number().default(0.5).describe('行调整的置信度阈值: confidence < 此值则进行行调整; 默认 0.5').optional(),
})
export type LineAdjustedArgs = z.output<typeof LineAdjustedArgsSchema>;