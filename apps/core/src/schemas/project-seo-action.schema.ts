import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { seoIdSchema, seoUrlSchema } from "./seo-page.schema";

export const MAX_STRATEGY_DECISIONS = 5;
const visible = (limit: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(limit)
    .refine(
      (value) =>
        ![...value].some((char) => {
          const code = char.codePointAt(0)!;
          return (
            code < 32 ||
            code === 127 ||
            (code >= 0x202a && code <= 0x202e) ||
            (code >= 0x2066 && code <= 0x2069)
          );
        }),
    );
const sentence = visible(600);
const decisionDetail = z.object({
  kind: z.enum([
    "content_opportunity",
    "internal_link_opportunity",
    "offer_availability",
  ]),
  alternative: sentence,
  nextCheck: sentence,
});
/** Only public decision types from a full audit may enter shared actions. */
export const publicSeoDecisionSchema = decisionDetail
  .extend({
    id: z.string().regex(/^[a-zA-Z0-9_.:-]{1,160}$/),
    targetUrl: seoUrlSchema.max(2048).refine((value) => !value.includes("#")),
    action: sentence,
    reason: sentence,
    evidence: z.array(visible(256)).min(1).max(8),
  })
  .strict();
export type PublicSeoDecision = z.infer<typeof publicSeoDecisionSchema>;
export const seoActionSchema = z
  .object({
    id: z.string(),
    observationId: seoIdSchema,
    pageUrl: seoUrlSchema,
    findingIds: z.array(z.string()),
    title: z.string(),
    why: z.string(),
    effort: z.enum(["low", "medium", "high", "unknown"]),
    expectedEffect: z.string(),
    edit: z.union([
      z.object({
        target: z.string(),
        before: z.string().nullable(),
        after: z.string(),
      }),
      z.null(),
    ]),
    decision: decisionDetail.optional(),
    taskId: z.string().nullable(),
    status: z.enum([
      "recommended",
      "task_created",
      "implemented",
      "verified",
      "canceled",
      "failed",
    ]),
    /** When the linked Task last completed. Set on an implemented or verified action. */
    completedAt: dateTimeSchema.optional(),
    /** When the last check that shows every finding of the fix gone ran; it can come before completedAt. Set on a verified fix. */
    verifiedAt: dateTimeSchema.optional(),
    /** A fix comes from a confirmed check. An opportunity is a named heuristic over measured search data. */
    kind: z.enum(["fix", "opportunity"]),
    evidence: z.array(z.string()),
  })
  .openapi("ProjectSeoAction");
