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
      v.rows.every((row) => new URL(row.pageUrl).hostname === v.verifiedHost),
  );
export type PrivateLandingOutcomes = z.infer<
  typeof privateLandingOutcomeSchema
>;
