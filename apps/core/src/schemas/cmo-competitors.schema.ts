import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { COMPETITOR_SOURCE_STATUSES } from "@/services/cmo-competitor-check.service";

export const cmoCompetitorParamsSchema = cmoProjectParamsSchema.extend({
  competitorId: z
    .string()
    .uuid()
    .openapi({ param: { name: "competitorId", in: "path" } }),
});

const address = z.string().trim().max(500);
const account = z.string().trim().max(200);

/** What a member may set; `null` or an empty string clears a field. */
const competitorFields = {
  websiteUrl: address
    .nullable()
    .optional()
    .describe("Its website. A bare domain is read as https."),
  pricingUrl: address
    .nullable()
    .optional()
    .describe("The page that lists its prices."),
  instagramHandle: account
    .nullable()
    .optional()
    .describe("Its Instagram account: the handle or its address."),
  facebookHandle: account
    .nullable()
    .optional()
    .describe("Its Facebook Page: the name in its address, or the address."),
};

export const cmoCompetitorCreateSchema = z
  .object({ name: z.string().trim().min(1).max(80), ...competitorFields })
  .openapi("CmoCompetitorCreate");

export const cmoCompetitorUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    ...competitorFields,
  })
  .openapi("CmoCompetitorUpdate");

const competitorSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    websiteUrl: z.string().nullable(),
    pricingUrl: z.string().nullable(),
    instagramHandle: z.string().nullable(),
    facebookHandle: z.string().nullable(),
    source: z
      .enum(["RESEARCH", "MEMBER"])
      .describe("Who put it on the list: Brand Brain research, or a member."),
    createdAt: dateTimeSchema,
  })
  .openapi("CmoCompetitor");

const signalSchema = z
  .object({
    id: z.string().uuid(),
    competitorId: z.string().uuid(),
    kind: z.enum(["WEBSITE_CHANGE", "PRICE_CHANGE", "NEWS", "AD", "SOCIAL"]),
    summary: z.string().describe("What happened, in one line."),
    observedAt: dateTimeSchema,
    sourceUrl: z.string().nullable(),
    sourceTitle: z.string().nullable(),
    sourcePublisher: z.string().nullable(),
    quote: z
      .string()
      .nullable()
      .describe("The source's own words that back the summary."),
  })
  .openapi("CmoCompetitorSignal");

/** A number with where and when it was read, for the hover. */
const measureSchema = z
  .object({
    value: z.number(),
    sourceUrl: z.string().nullable(),
    observedAt: dateTimeSchema,
  })
  .openapi("CmoCompetitorMeasure");

const scoreRowSchema = z
  .object({
    competitorId: z
      .string()
      .uuid()
      .nullable()
      .describe("Null for the business itself."),
    name: z.string(),
    postsPerWeek: measureSchema.nullable(),
    engagementPerPost: measureSchema
      .nullable()
      .describe("Likes and comments per post over the week's posts."),
    followers: measureSchema.nullable(),
    followerGrowth: measureSchema
      .nullable()
      .describe("Followers gained since the reading a week before."),
  })
  .openapi("CmoCompetitorScoreRow");

const topPostSchema = z
  .object({
    competitorId: z.string().uuid(),
    signalId: z.string().uuid(),
    url: z.string().nullable(),
    caption: z.string().nullable(),
    type: z.string().nullable(),
    postedAt: dateTimeSchema,
    likes: z.number().nullable(),
    comments: z.number().nullable(),
  })
  .openapi("CmoCompetitorTopPost");

const sourceSchema = z
  .object({
    status: z
      .enum(COMPETITOR_SOURCE_STATUSES)
      .describe(
        "not_configured: CMO lacks access to this source. not_connected: the owner has not connected the account it is read through. failed: the last check could not read it.",
      ),
    needs: z
      .string()
      .nullable()
      .describe("What it takes to read this source, when it cannot be read."),
  })
  .openapi("CmoCompetitorSource");

export const cmoCompetitorsSchema = z
  .object({
    competitors: z.array(competitorSchema),
    limit: z.number().int().describe("How many competitors can be tracked."),
    signals: z
      .array(signalSchema)
      .describe("What the checks of the last 30 days found, newest first."),
    scoreboard: z
      .array(scoreRowSchema)
      .describe(
        "Instagram numbers: the business first, then each competitor. A null cell has no data.",
      ),
    topPosts: z
      .array(topPostSchema)
      .describe("Each competitor's three strongest Instagram posts."),
    check: z.object({
      lastCheckedAt: dateTimeSchema.nullable(),
      nextCheckAt: dateTimeSchema.nullable(),
      creditsPerCompetitor: z.number(),
      sources: z.object({
        pages: sourceSchema,
        news: sourceSchema,
        ads: sourceSchema,
        social: sourceSchema,
      }),
    }),
  })
  .openapi("CmoCompetitors");
