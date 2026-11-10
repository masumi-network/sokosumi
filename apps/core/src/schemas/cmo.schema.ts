import { z } from "@hono/zod-openapi";
import {
  brandBrainSchema,
  CMO_BRAND_SECTION_KEYS,
  cmoReportUpdateInputSchema,
  marketingStrategyPlanSchema,
} from "@sokosumi/soko-bot";

import { dateTimeSchema } from "@/helpers/datetime";
import { marketingStrategyVersionSchema } from "@/schemas/marketing-strategy.schema";
import { CMO_ONBOARDING_STEPS } from "@/services/cmo-overview.service";

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

export const cmoMeasurementSchema = z
  .object({
    provider: z.enum(["google_analytics", "google_search_console", "shopify"]),
    name: z.string(),
    measures: z.string(),
    status: z.enum(["connected", "pending", "none"]),
  })
  .openapi("CmoMeasurement");

/** A plan, named once: the overview carries the newest and the approved one. */
const cmoPlanSchema = marketingStrategyPlanSchema.openapi("CmoPlan");

export const cmoProductionSchema = z
  .object({
    state: z
      .enum(["waiting", "starting", "running", "ready", "stuck"])
      .describe(
        "starting: approved, but no run is working yet; the next sync starts one.",
      ),
    ready: z.number().int(),
    total: z.number().int(),
    written: z.number().int().describe("Pieces whose words are written."),
    pictured: z
      .number()
      .int()
      .describe("Pieces with every picture they need, of needPictures."),
    needPictures: z.number().int(),
    finishedAt: z.union([z.string(), z.null()]),
    pillars: z
      .union([
        z.object({
          shares: z.array(
            z.object({
              name: z.string(),
              planned: z.number().int(),
              made: z.number().int(),
              pieces: z.number().int(),
            }),
          ),
          rewriting: z.boolean(),
        }),
        z.null(),
      ])
      .describe(
        "Once the made month was read: each pillar's planned share beside the share its pieces really have, and whether Cuso is rewriting pieces off their pillar.",
      ),
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
  .object({
    note: z.string().trim().max(1_000).optional(),
    patch: z
      .boolean()
      .optional()
      .describe(
        "With a note: Cuso changes only the entries the note touches (a no, the pace) in a short turn, instead of writing a new plan.",
      ),
    restart: z
      .boolean()
      .optional()
      .describe(
        "Try again: replaces a plan running past twice the usual time. Otherwise a plan being written is returned as it is.",
      ),
  })
  .openapi("CmoStrategyRequest");

/** The Project of the Cuso a CMO route acts on. */
export const cmoProjectParamsSchema = z.object({
  projectId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "projectId", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
});

export const cmoBrandFixRequestSchema = z
  .object({
    section: z.enum(CMO_BRAND_SECTION_KEYS),
    note: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .describe("What is true instead, in the owner's words."),
  })
  .openapi("CmoBrandFixRequest");

export const cmoBrandFixStartedSchema = z
  .object({
    turnId: z.union([z.string(), z.null()]),
    queued: z
      .boolean()
      .describe(
        "Cuso is busy: the fix is kept on its section and starts when his current turn ends.",
      ),
  })
  .openapi("CmoBrandFixStarted");

export const cmoUpdateIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

/** The words of a piece that lives in the Project's Files. */
export const cmoPieceTextSchema = z
  .object({ text: z.string() })
  .openapi("CmoPieceText");

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
    change: z
      .union([z.enum(["fix", "patch"]), z.null()])
      .optional()
      .describe(
        "A strategy turn that fixes Brand Brain sections or patches the plan's entries; null for a whole plan.",
      ),
    status: z.enum(["running", "failed", "done"]),
    startedAt: dateTimeSchema,
    steps: z.array(cmoWorkStepSchema),
    /** Each profile section stored so far, in profile order. */
    sections: z
      .array(
        z.object({
          key: z.enum(CMO_BRAND_SECTION_KEYS),
          headline: z.string().describe("The section's answer at a glance."),
        }),
      )
      .describe("Brand Brain sections Cuso has saved, in profile order."),
    /** Brand Brain profile sections stored so far, of `sectionsTotal`. */
    sectionsSaved: z.number().int().min(0),
    sectionsTotal: z.number().int().min(0),
  })
  .openapi("CmoWork");

export const cmoResearchSchema = z
  .object({
    groups: z
      .array(
        z.object({
          key: z.string(),
          label: z.string(),
          sections: z
            .array(z.enum(CMO_BRAND_SECTION_KEYS))
            .describe("The Brand Brain sections this group researches."),
          state: z.enum(["running", "done"]),
        }),
      )
      .describe(
        "The research in six groups of Brand Brain sections, in the order Cuso saves them; done once every section in a group is saved, or the essentials are.",
      ),
    preview: z
      .union([
        z.object({ line: z.string(), facts: z.array(z.string()) }),
        z.null(),
      ])
      .describe(
        "The quick look from the homepage alone, until the essentials replace it. The plan never reads it.",
      ),
  })
  .openapi("CmoResearch");

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
        "Whether this member may approve the strategy: the organization's owners and admins only. Every other member works with Cuso but cannot.",
      ),
    work: z.union([cmoWorkSchema, z.null()]),
    research: cmoResearchSchema,
    brandVisual: z.union([cmoBrandVisualSchema, z.null()]),
    projectLogo: z.union([z.string(), z.null()]),
    onboardingStep: z
      .enum(CMO_ONBOARDING_STEPS)
      .describe(
        "Where Hiring Cuso stands, read from the data: the Brand Brain until a member confirms it, the strategy until a version is approved, the accounts until the Project has a Social connection or this person skipped them. CMO opens on the chat once done.",
      ),
    routines: z.array(cmoRoutineSchema),
    brandBrain: z.union([brandBrainSchema, z.null()]),
    brandBrainUpdatedAt: z.union([dateTimeSchema, z.null()]),
    brandBrainConfirmedAt: z.union([dateTimeSchema, z.null()]),
    brandMedia: z.union([cmoBrandMediaSchema, z.null()]),
    strategy: z.union([cmoPlanSchema, z.null()]),
    approvedStrategy: z
      .union([cmoPlanSchema, z.null()])
      .describe(
        "The approved version as Cuso carries it out, with the pieces he made: the month the Calendar shows. Differs from strategy while a change waits for approval.",
      ),
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
    hiredAt: z
      .union([dateTimeSchema, z.null()])
      .describe(
        "When a plan was first approved, so hiring ended. Unlike the approved version's approvedAt, a later approval does not move it.",
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
      "After approval Cuso makes the whole month at once: how many of its pieces are made.",
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
