import { z } from "@hono/zod-openapi";

const windowSchema = z.object({
  from: z.string(),
  to: z.string(),
  sessions: z.number().int().positive(),
  observationId: z.uuid(),
});
const rateChange = z.object({
  before: z.number().nonnegative(),
  after: z.number().nonnegative(),
  withinPageChange: z.number(),
  mixChange: z.number(),
});

/** Rates in verified organic landing sessions across the same selected pages in two complete windows. */
export const seoLandingEngagementChange = z.object({
  propertyId: z.string(),
  timeZone: z.string(),
  pageCount: z.number().int().positive(),
  before: windowSchema,
  after: windowSchema,
  engagementSecondsPerSession: rateChange,
  viewsPerSession: rateChange,
});
