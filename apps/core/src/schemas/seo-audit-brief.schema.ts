import { z } from "@hono/zod-openapi";
import { SEO_MAX_PAGES, seoBriefAction, seoIdSchema } from "./seo-page.schema";

export { seoBriefAction } from "./seo-page.schema";

import {
  seoBriefOutcome,
  seoLandingEvents,
} from "./seo-landing-outcomes.schema";

export const seoBriefObjective = z.enum(["sales", "traffic", "support"]);
export const seoBriefPageRole = z.enum([
  "guide",
  "product",
  "pricing",
  "support",
  "comparison",
  "other",
]);

export const seoBriefSuggestionQuery = z.strictObject({ pageId: seoIdSchema });
export const seoBriefSuggestionSchema = z
  .strictObject({ action: seoBriefAction.nullable() })
  .openapi("SeoBriefSuggestion");

const text = (max: number) => z.string().trim().min(1).max(max).nullable();
const shortTextLimit = 300;
const constraintsLimit = 600;
const page = z.strictObject({
  pageId: seoIdSchema,
  role: seoBriefPageRole.nullable(),
  job: text(shortTextLimit),
  action: seoBriefAction.nullable(),
  indexIntent: z.enum(["index", "exclude", "unknown"]),
});

export const seoBriefContent = z.strictObject({
  objective: seoBriefObjective.nullable(),
  audience: text(shortTextLimit),
  outcome: text(shortTextLimit),
  constraints: text(constraintsLimit),
  pages: z
    .array(page)
    .max(SEO_MAX_PAGES)
    .refine(
      (pages) =>
        new Set(pages.map((item) => item.pageId)).size === pages.length,
      "Describe each page once",
    ),
});
export type SeoBriefContent = z.infer<typeof seoBriefContent>;
export const saveSeoAuditBriefRequestSchema = seoBriefContent
  .extend({
    expectedRevision: z.number().int().nonnegative(),
  })
  .openapi("SaveSeoAuditBriefRequest");

const followUp = z.strictObject({
  pageId: seoIdSchema,
  changedAt: z.iso.datetime().nullable(),
  lastCrawlAt: z.iso.datetime().nullable(),
  outcomes: z.array(seoBriefOutcome).max(seoLandingEvents.length).optional(),
  status: z.enum(["awaiting_recrawl", "recrawled", "unknown"]),
  indexReview: z.enum([
    "expected_exclusion",
    "review_exclusion",
    "review_indexing",
    "unknown",
    "matches_intent",
  ]),
});
export type SeoBriefFollowUp = z.infer<typeof followUp>;
export const seoAuditBriefSchema = seoBriefContent
  .extend({
    revision: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime().nullable(),
    followUps: z.array(followUp).max(SEO_MAX_PAGES),
    priorities: z
      .array(
        z.strictObject({
          pageId: seoIdSchema,
          why: z.array(z.string()),
          nextStep: z.string(),
        }),
      )
      .max(SEO_MAX_PAGES),
  })
  .openapi("SeoAuditBrief");
export type SeoAuditBrief = z.infer<typeof seoAuditBriefSchema>;
