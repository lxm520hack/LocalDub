import { z } from "zod";

export const CookieArgsSchema = z.object({
  action: z.enum(['set']).default('set').optional(),
  service: z.enum(['youtube']).default('youtube').optional(),
  content: z.string().optional().describe("Netscape cookie 为空则, 让用户主动输入"),
})