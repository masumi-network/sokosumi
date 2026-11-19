import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { COMPETITOR_CHECK_CREDITS } from "@/lib/competitors/price";
import { COMPETITOR_SOURCE_STATUSES } from "@/services/competitor-check.service";

export const projectCompetitorsParamsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: "id", in: "path" } }),
});

export const competitorIdParam = z
  .string()
  .uuid()
  .openapi({ param: { name: "competitorId", in: "path" } });

export const projectCompetitorParamsSchema =
  projectCompetitorsParamsSchema.extend({ competitorId: competitorIdParam });

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

export const projectCompetitorCreateSchema = z
  .object({ name: z.string().trim().min(1).max(80), ...competitorFields })
  .openapi("ProjectCompetitorCreate");

export const projectCompetitorUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    ...competitorFields,
  })
  .openapi("ProjectCompetitorUpdate");

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
  .openapi("ProjectCompetitor");

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
  .openapi("ProjectCompetitorSignal");

/** A number with where and when it was read, for the hover. */
const measureSchema = z
  .object({
    value: z.number(),
    sourceUrl: z.string().nullable(),
    observedAt: dateTimeSchema,
  })
  .openapi("ProjectCompetitorMeasure");

/**
 * A cell that may have no data. A union, not `.nullable()`: on a named
 * schema that makes the generated client's transformer read into `null`.
 */
const cellSchema = z.union([measureSchema, z.null()]);

const scoreRowSchema = z
  .object({
    competitorId: z
      .string()
      .uuid()
      .nullable()
      .describe("Null for the business itself."),
    name: z.string(),
    postsPerWeek: cellSchema,
    engagementPerPost: cellSchema.describe(
      "Likes and comments per post over the week's posts.",
    ),
    followers: cellSchema,
    followerGrowth: cellSchema.describe(
      "Followers gained since the reading a week before.",
    ),
  })
  .openapi("ProjectCompetitorScoreRow");

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
  .openapi("ProjectCompetitorTopPost");

const sourceSchema = z
  .object({
    status: z
      .enum(COMPETITOR_SOURCE_STATUSES)
      .describe(
        "not_configured: Core lacks access to this source. not_connected: the owner has not connected the account it is read through. failed: the last check could not read it.",
      ),
    needs: z
      .string()
      .nullable()
      .describe("What it takes to read this source, when it cannot be read."),
  })
  .openapi("ProjectCompetitorSource");

const feedItemSchema = z
  .object({
    id: z.string().uuid(),
    competitorId: z.string().uuid(),
    facts: z.array(
      z.object({
        text: z.string(),
        signalIds: z
          .array(z.string().uuid())
          .describe("The signals that back it; their sources show on hover."),
        support: z
          .enum(["strong", "weak"])
          .describe("weak: the sources back it only in part."),
      }),
    ),
    meaning: z.string().describe("What this means for you."),
    move: z.string().describe("One suggested move."),
    big: z
      .boolean()
      .describe("A price change, launch or ad burst, told in chat at once."),
    addedToStrategyAt: z.string().nullable(),
  })
  .openapi("ProjectCompetitorFeedItem");

/** A Project's Competitors page; CMO adds its market map's players. */
export const projectCompetitorsShape = {
  competitors: z.array(competitorSchema),
  feed: z
    .object({
      checkDay: z
        .string()
        .describe("The day of the check it was written from."),
      savedAt: dateTimeSchema,
      items: z.array(feedItemSchema),
      openQuestions: z
        .array(z.string())
        .describe("What the sources could not settle this week."),
    })
    .nullable()
    .describe("This week: null until a bot wrote one."),
  limit: z.number().int().describe("How many competitors can be tracked."),
  signals: z
    .array(signalSchema)
    .describe(
      "What the checks of the last 35 days found, newest first: every signal a feed fact can cite, Instagram readings included.",
    ),
  scoreboard: z
    .array(scoreRowSchema)
    .describe(
      "Instagram numbers: the business first, then each competitor. A null cell has no data.",
    ),
  topPosts: z
    .array(topPostSchema)
    .describe("Each competitor's three strongest Instagram posts."),
  check: z.object({
    on: z
      .boolean()
      .describe(
        "Whether the weekly check runs: a member turned it on, or the Project is a CMO Project, whose check runs while its Cuso is paid for.",
      ),
    lastCheckedAt: dateTimeSchema.nullable(),
    nextCheckAt: dateTimeSchema.nullable(),
    creditsPerCompetitor: z
      .number()
      .describe("What one competitor costs in one weekly check, in credits."),
    sources: z.object({
      pages: sourceSchema,
      news: sourceSchema,
      ads: sourceSchema,
      social: sourceSchema,
    }),
  }),
};

export const projectCompetitorsSchema = z
  .object(projectCompetitorsShape)
  .openapi("ProjectCompetitors");

export const projectCompetitorChecksSchema = z
  .object({
    on: z
      .boolean()
      .describe(
        `true turns the weekly check on: ${COMPETITOR_CHECK_CREDITS} credits per competitor a week, charged to the Project's organization (or the person, in a personal workspace). false turns it off and keeps what the checks found.`,
      ),
  })
  .openapi("ProjectCompetitorChecks");

export const projectCompetitorCheckRunSchema = z
  .object({
    outcome: z
      .enum(["checked", "not_due", "no_competitors", "paused", "unfunded"])
      .describe(
        "checked: the check ran. not_due: the last one is under a week old, or one is running. no_competitors: nothing is tracked. paused: the weekly check is off. unfunded: there are not enough credits for it.",
      ),
    competitors: projectCompetitorsSchema,
  })
  .openapi("ProjectCompetitorCheckRun");
