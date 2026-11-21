import { z } from "@hono/zod-openapi";
import { CMO_BRAND_ANSWERS } from "@sokosumi/soko-bot";

/** A member's answer to a yes/no question of a Brand Brain or a strategy. */
export const questionAnswerRequestSchema = z
  .object({
    questionId: z.string().trim().min(1).max(40),
    answer: z.enum(CMO_BRAND_ANSWERS),
    note: z
      .string()
      .trim()
      .max(400)
      .optional()
      .describe(
        "The member's own words. After a no: what is true instead. A Brand Brain question keeps them with any answer; a strategy question only with a no.",
      ),
  })
  .openapi("QuestionAnswerRequest");
