import { z } from "@hono/zod-openapi";

/** Editorial origin of a keyword whose DataForSEO measurement was retained by the audit. */
export const seoEditorialKeywordSchema = z.object({
  models: z
    .array(z.enum(["gemini", "codex"]))
    .min(1)
    .max(2),
  record: z.string().regex(/^[a-f0-9]{64}$/),
  angle: z
    .object({
      quote: z.string().min(8).max(180),
      nextStep: z.string().min(8).max(180),
    })
    .optional(),
});
