import { z } from "zod";

export const MergeFramesArgsSchema = z.object({
  mergeSubstring: z.boolean().default(false).optional(),
})
export type MergeFramesArgs = z.output<typeof MergeFramesArgsSchema>;