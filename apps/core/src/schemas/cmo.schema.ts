import { z } from "@hono/zod-openapi";
import {
  CMO_BRAND_ANSWERS,
  cmoBrandBrainSchema,
  cmoReportUpdateInputSchema,
  cmoStrategySchema,
} from "@sokosumi/soko-bot";

import { dateTimeSchema } from "@/helpers/datetime";
import { marketingStrategyVersionSchema } from "@/schemas/marketing-strategy.schema";

export const cmoOnboardingRequestSchema = z
  .object({
    websiteUrl: z
      .string()
      .trim()
      .url()
      .max(500)
      .describe(
        "The business's website. Cuso is hired into a new organization named after it.",
      ),
  })
  .openapi("CmoOnboardingRequest");

export const cmoMockPlanRequestSchema = z
  .object({
    plan: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,31}$/)
      .describe("A CMO tier id from CMO's own plan config."),
  })
  .openapi("CmoMockPlanRequest");

export const cmoBrandAnswerRequestSchema = z
  .object({
    questionId: z.string().trim().min(1).max(40),
    answer: z.enum(CMO_BRAND_ANSWERS),
    note: z
      .string()
      .trim()
      .max(400)
      .optional()
      .describe("After a no: what is true instead, in the owner's words."),
  })
  .openapi("CmoBrandAnswerRequest");

export const cmoStrategyApproveRequestSchema = z
  .object({
    versionId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "The Marketing strategy version to approve; the newest when left out. An older one reverts to it.",
      ),
  })
  .openapi("CmoStrategyApproveRequest");

export const cmoMeasurementSchema = z
  .object({
    provider: z.enum(["google_analytics", "google_search_console", "shopify"]),
    name: z.string(),
    measures: z.string(),
    status: z.enum(["connected", "pending", "none"]),
  })
  .openapi("CmoMeasurement");

export const cmoProductionSchema = z
  .object({
    state: z.enum(["waiting", "running", "ready", "stuck"]),
    ready: z.number().int(),
    total: z.number().int(),
    finishedAt: z.union([z.string(), z.null()]),
  })
  .openapi("CmoProduction");

export const cmoAdBudgetRequestSchema = z
  .object({
    monthly: z.number().min(0).max(10_000_000),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .describe("ISO 4217, such as EUR."),
  })
  .openapi("CmoAdBudgetRequest");

export const cmoStrategyRequestSchema = z
  .object({ note: z.string().trim().max(1_000).optional() })
  .openapi("CmoStrategyRequest");

export const cmoUpdateIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

/** A report is its card's message in Cuso's shared room. */
export const cmoReportIdParamsSchema = z.object({ id: z.string().uuid() });

export const cmoUpdateSchema = cmoReportUpdateInputSchema
  .extend({
    id: z.string(),
    at: dateTimeSchema,
    revertible: z.boolean(),
    revertedAt: z.union([dateTimeSchema, z.null()]),
  })
  .openapi("CmoUpdate");

export const cmoChannelSchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    handle: z.union([z.string(), z.null()]),
    displayName: z.union([z.string(), z.null()]),
    status: z.string(),
  })
  .openapi("CmoChannel");

export const cmoUpNextItemSchema = z
  .object({
    id: z.string(),
    date: z.string(),
    channel: z.string(),
    title: z.string(),
    status: z.string(),
  })
  .openapi("CmoUpNextItem");

export const cmoWorkStepSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["search", "read", "study", "brain", "strategy", "other"]),
    label: z.string(),
    url: z.union([z.string(), z.null()]),
    status: z.enum(["running", "done", "failed"]),
    at: dateTimeSchema,
  })
  .openapi("CmoWorkStep");

export const cmoWorkSchema = z
  .object({
    kind: z.enum(["research", "strategy"]),
    status: z.enum(["running", "failed", "done"]),
    startedAt: dateTimeSchema,
    steps: z.array(cmoWorkStepSchema),
    /** Brand Brain profile sections stored so far, of `sectionsTotal`. */
    sectionsSaved: z.number().int().min(0),
    sectionsTotal: z.number().int().min(0),
  })
  .openapi("CmoWork");

export const cmoBrandVisualSchema = z
  .object({
    logoUrl: z.union([z.string(), z.null()]),
    colors: z.array(z.string()),
    fonts: z.array(z.string()),
    siteName: z.union([z.string(), z.null()]),
    designMdUrl: z.union([z.string(), z.null()]),
    images: z
      .array(z.string())
      .describe(
        "The brand's pictures from the Project's Brand research files, for post previews.",
      ),
  })
  .describe(
    "The brand's look, read from the Project's logo and DESIGN.md (colours, fonts and name).",
  )
  .openapi("CmoBrandVisual");

const cmoMediaFileSchema = z.object({
  /** Public Blob address the CMO app shows; never handed to anyone else. */
  url: z.string(),
  fileId: z.union([z.string(), z.null()]),
});

export const cmoBrandMediaSchema = z
  .object({
    capturedAt: z.string(),
    pages: z
      .array(
        cmoMediaFileSchema.extend({
          label: z.string(),
          pageUrl: z.string(),
          device: z.enum(["desktop", "mobile"]),
        }),
      )
      .describe("The brand's own pages, home first, then home on a phone."),
    competitors: z
      .array(
        cmoMediaFileSchema.extend({ name: z.string(), pageUrl: z.string() }),
      )
      .describe("Each competitor's homepage, in the Brand Brain's order."),
    pictures: z
      .array(
        cmoMediaFileSchema.extend({
          /** Read from the file name; empty when the site gave none. */
          alt: z.string(),
        }),
      )
      .describe(
        "The large pictures on the brand's pages: products, screens, people.",
      ),
  })
  .openapi("CmoBrandMedia");
export type CmoBrandMedia = z.infer<typeof cmoBrandMediaSchema>;

export const cmoRoutineSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    when: z.string(),
    description: z.string(),
    nextRunAt: z.union([dateTimeSchema, z.null()]),
    timezone: z.union([z.string(), z.null()]),
  })
  .openapi("CmoRoutine");

export const cmoOverviewSchema = z
  .object({
    id: z.string(),
    businessName: z.string(),
    websiteUrl: z.string(),
    /** Set when Cuso works in an organization's workspace, not a personal one. */
    organizationSlug: z.union([z.string(), z.null()]),
    projectName: z.string(),
    workspaceId: z.string(),
    sokoBotId: z.string(),
    projectId: z.string(),
    roomId: z.string(),
    botStatus: z.string(),
    learning: z
      .enum(["running", "failed", "done"])
      .describe(
        "Cuso's first look at the business: still running, failed or stuck (offer a retry), or done.",
      ),
    subscriptionActive: z.boolean(),
    viewerCanApprove: z
      .boolean()
      .describe(
        "Whether this member may approve the strategy and start the paid month: the organization's owners and admins only. Every other member works with Cuso but cannot.",
      ),
    work: z.union([cmoWorkSchema, z.null()]),
    brandVisual: z.union([cmoBrandVisualSchema, z.null()]),
    projectLogo: z.union([z.string(), z.null()]),
    onboardingStep: z
      .enum(["brandBrain", "strategy", "accounts", "plan", "done"])
      .describe(
        "Where Hiring Cuso stands, read from the data: the Brand Brain until a member confirms it, the strategy until a version is approved, the accounts until the Project has a Social connection or this person skipped them, the plan until the organization has an active CMO plan. CMO opens on the chat once done.",
      ),
    mockBilling: z
      .boolean()
      .describe("CMO offers its own mock tiers instead of Sokosumi checkout."),
    mockPlan: z.union([z.string(), z.null()]),
    mockPlanActivatedAt: z.union([dateTimeSchema, z.null()]),
    routines: z.array(cmoRoutineSchema),
    brandBrain: z.union([cmoBrandBrainSchema, z.null()]),
    brandBrainUpdatedAt: z.union([dateTimeSchema, z.null()]),
    brandBrainApprovedAt: z.union([dateTimeSchema, z.null()]),
    brandMedia: z.union([cmoBrandMediaSchema, z.null()]),
    strategy: z.union([cmoStrategySchema, z.null()]),
    media: z
      .array(
        z.object({
          entryId: z.string(),
          kind: z.enum(["image", "video"]),
          url: z.string(),
          /** A carousel's slides in order, the cover first. */
          slides: z.array(z.string()).optional(),
        }),
      )
      .describe(
        "The image or video Cuso attached to each calendar piece, by entry id.",
      ),
    strategyVersion: z
      .union([marketingStrategyVersionSchema, z.null()])
      .describe(
        "The newest Marketing strategy version, whose plan `strategy` shows: approved, or a draft waiting for an owner or admin.",
      ),
    strategyVersions: z
      .array(marketingStrategyVersionSchema)
      .describe(
        "Every version, newest first. At most one is approved; approving an older one reverts to it.",
      ),
    updates: z.array(cmoUpdateSchema),
    channels: z.array(cmoChannelSchema),
    upNext: z.array(cmoUpNextItemSchema),
    connectChannelUrl: z.string(),
    adProviders: z.array(z.string()),
    connectAdsUrl: z.string(),
    measurement: z
      .array(cmoMeasurementSchema)
      .describe(
        "Where Cuso reads the funnel's numbers: Google Analytics, Search Console and Shopify.",
      ),
    production: cmoProductionSchema.describe(
      "After payment Cuso makes the whole month at once: how many of its pieces are made.",
    ),
    mailingListSize: z.number().int(),
    subscribeUrl: z.string(),
    billing: z.object({
      plan: z.union([z.string(), z.null()]),
      subscriptionStatus: z.union([z.string(), z.null()]),
      availableCredits: z.number(),
    }),
    posts: z.object({
      draft: z.number(),
      scheduled: z.number(),
      published: z.number(),
      failed: z.number(),
    }),
    createdAt: dateTimeSchema,
  })
  .openapi("CmoOverview");

export const cmoTurnStartedSchema = z
  .object({ turnId: z.string() })
  .openapi("CmoTurnStarted");
