import { z } from "@hono/zod-openapi";
import {
  SEO_MAX_PAGES,
  seoDateSchema,
  seoUrlSchema,
} from "./project-seo.schema";

export const seoLandingEvents = ["purchase", "sign_up"] as const;
export const seoLandingEventSchema = z.enum(seoLandingEvents);
export const seoOutcomeWindow = z.strictObject({
  from: seoDateSchema,
  to: seoDateSchema,
  count: z.number().int().nonnegative(),
});
export const seoBriefOutcome = z.strictObject({
  event: seoLandingEventSchema,
  latest: seoOutcomeWindow,
  comparison: z
    .strictObject({ before: seoOutcomeWindow, after: seoOutcomeWindow })
    .optional(),
});
export type SeoBriefOutcome = z.infer<typeof seoBriefOutcome>;

const goalChannel = z.strictObject({
  sessions: z.number().int().positive(),
  rate: z.number().min(0).max(1),
});
const goalPeriod = z.strictObject({
  from: seoDateSchema,
  to: seoDateSchema,
  organic: goalChannel,
  direct: goalChannel,
});
export const seoGoalInvestigation = z.strictObject({
  pageUrl: seoUrlSchema,
  timeZone: z.string().min(1).max(100),
  event: seoLandingEventSchema,
  before: goalPeriod,
  after: goalPeriod,
  weekdayMix: z.literal("uneven").optional(),
  assessment: z.enum(["both_declined", "organic_declined", "goal_held"]),
});
export type SeoGoalInvestigation = z.infer<typeof seoGoalInvestigation>;

export const privateLandingOutcomeSchema = z
  .strictObject({
    version: z.literal(1),
    channel: z.literal("organic"),
    accountKey: z.string().regex(/^[a-f0-9]{64}$/),
    propertyId: z.string().min(1).max(500),
    verifiedHost: z.string().min(1).max(253),
    timeZone: z.string().min(1).max(100).nullable(),
    from: seoDateSchema,
    to: seoDateSchema,
    goalInvestigation: seoGoalInvestigation.optional(),
    rows: z
      .array(
        z.strictObject({
          pageUrl: seoUrlSchema,
          event: seoLandingEventSchema,
          count: z.number().int().nonnegative(),
        }),
      )
      .max(SEO_MAX_PAGES * seoLandingEvents.length),
  })
  .refine(
    (v) =>
      v.from <= v.to &&
      (!v.goalInvestigation ||
        (v.timeZone === v.goalInvestigation.timeZone &&
          new URL(v.goalInvestigation.pageUrl).hostname === v.verifiedHost &&
          v.goalInvestigation.after.from === v.from &&
          v.goalInvestigation.after.to === v.to &&
          v.goalInvestigation.before.to < v.from)) &&
      v.rows.every((row) => new URL(row.pageUrl).hostname === v.verifiedHost),
  );
// A successful source selection may have no publishable counts or verified landing host.
export const privateLandingSourceSchema = z.strictObject({
  version: z.literal(2),
  accountKey: z.string().regex(/^[a-f0-9]{64}$/),
  propertyId: z.string().min(1).max(500),
});
export type PrivateLandingOutcomes = z.infer<
  typeof privateLandingOutcomeSchema
>;
