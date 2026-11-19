import { z } from "@hono/zod-openapi";
import {
  brandBrainSchema,
  CMO_BRAND_SECTION_KEYS,
  cmoReportUpdateInputSchema,
  marketingStrategyPlanSchema,
} from "@sokosumi/soko-bot";

import { dateTimeSchema } from "@/helpers/datetime";
import { errorResponseWithExtensionsSchema } from "@/helpers/error";
import { marketingStrategyVersionSchema } from "@/schemas/marketing-strategy.schema";
import { finalizeProjectSocialConnectionRequestSchema } from "@/schemas/project-social-connection.schema";
import { tikTokPostSettingsSchema } from "@/schemas/social-post.schema";
import { CMO_ONBOARDING_STEPS } from "@/services/cmo-overview.service";

/** An IANA time zone this server knows, such as "America/New_York". */
export const cmoTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Not a time zone" },
  );

export const cmoOnboardingRequestSchema = z
  .object({
    websiteUrl: z
      .string()
      .trim()
      .url()
      .max(500)
      .describe("The business's website, which names the new Project."),
    organizationId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "An organization the caller belongs to, to hire Cuso into a new Project there. Without it, Cuso is hired into a new organization named after the website.",
      ),
    timeZone: cmoTimeZoneSchema
      .optional()
      .describe(
        "The owner's time zone, from their browser: Cuso's routines run at their local times in it. Without it he works on Europe/Berlin time.",
      ),
    testCopyOfProjectId: z
      .uuid()
      .optional()
      .describe(
        "Hire a test copy of this Project's Cuso (ADR 0073), into his organization: `organizationId` may be left out and must match when given. The caller is one of its owners or admins, or a tester who belongs to it. The copy's Social connections are links to the source's connected accounts.",
      ),
  })
  .openapi("CmoOnboardingRequest");

/** A refused hire; `unpaidCuso` comes with `kind: cmo_unpaid_cuso`. */
export const cmoOnboardingConflictSchema = errorResponseWithExtensionsSchema(
  {
    unpaidCuso: z
      .object({
        projectId: z.string().uuid(),
        businessName: z.string(),
      })
      .optional()
      .describe(
        "The person's live Cuso that nobody paid for yet, to continue there instead.",
      ),
  },
  "CmoOnboardingConflictError",
);

/** One Cuso of the caller's, as CMO's Cuso picker lists him. */
export const cmoCusoSchema = z
  .object({
    projectId: z.string(),
    businessName: z.string(),
    websiteUrl: z.string(),
    projectLogo: z.union([z.string(), z.null()]),
    organizationId: z.string(),
    organizationName: z.string(),
    hiring: z
      .boolean()
      .describe("No plan of his is approved yet: he is still being hired."),
    createdAt: dateTimeSchema,
  })
  .openapi("CmoCuso");

/** The caller's Cusos, and whether they may hire another (CMO is invite-only). */
export const cmoCusoListSchema = z
  .object({
    cusos: z.array(cmoCusoSchema),
    mayHire: z
      .boolean()
      .describe("The caller is on Core's hire allowlist (CMO_HIRE_ALLOWLIST)."),
  })
  .openapi("CmoCusoList");

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
  .object({ note: z.string().trim().max(1_000).optional() })
  .openapi("CmoStrategyRequest");

/** A CMO plan as Polar sells it (ADR 0068); not the marketing plan above. */
export const cmoSubscriptionPlanSchema = z
  .object({
    tier: z
      .string()
      .min(1)
      .describe("The plan's tier, as its Polar product names it."),
    name: z.string(),
    interval: z.enum(["month", "year"]),
    credits: z
      .number()
      .int()
      .describe("Credits granted every month, on a yearly plan too."),
    priceAmount: z
      .number()
      .int()
      .describe("Price per interval in the currency's minor unit."),
    currency: z.string(),
  })
  .openapi("CmoSubscriptionPlan");

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

/** A version of the plan of the Cuso a CMO route acts on. */
export const cmoTestCopyCheckSchema = z
  .object({
    projectId: z.string().uuid(),
    sourceProjectId: z
      .string()
      .uuid()
      .describe("The Project whose connected accounts the copy uses."),
    tornDownAt: z.date().nullable(),
    clean: z
      .boolean()
      .describe(
        "Nothing is left: no unsent post, linked account, run or Cuso.",
      ),
    left: z.object({
      unsentPosts: z.number().int(),
      linkedAccounts: z.number().int(),
      activeTurns: z.number().int(),
      liveCuso: z.boolean(),
    }),
    publishedPosts: z
      .number()
      .int()
      .describe("Posts of the copy that went out. Always 0."),
    providerRevocations: z
      .number()
      .int()
      .describe("Accounts ended at the provider through the copy. Always 0."),
  })
  .openapi("CmoTestCopyCheck");

export const cmoTestCopyTeardownSchema = z
  .object({
    removed: z.object({
      canceledPosts: z.number().int(),
      unlinkedAccounts: z.number().int(),
      stoppedTurns: z.number().int(),
      archivedCuso: z.boolean(),
    }),
    check: cmoTestCopyCheckSchema,
  })
  .openapi("CmoTestCopyTeardown");

export const cmoStrategyParamsSchema = cmoProjectParamsSchema.extend({
  strategyId: z
    .string()
    .uuid()
    .openapi({ param: { name: "strategyId", in: "path" } }),
});

export const cmoUpdateIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

/** The words of a piece that lives in the Project's Files. */
export const cmoPieceTextSchema = z
  .object({ text: z.string() })
  .openapi("CmoPieceText");

export const cmoChatTableSchema = z
  .object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    total: z.number().int().describe("Every row the table holds."),
  })
  .openapi("CmoChatTable");

export const cmoChatWorkItemSchema = z
  .object({
    id: z
      .string()
      .describe("The tool call that started it; a weekly audit's own id."),
    kind: z
      .enum([
        "image",
        "video",
        "audio",
        "file",
        "task",
        "agent",
        "table",
        "contacts",
        "run",
        "question",
        "seo",
        "audit",
      ])
      .describe(
        "A picture, video or voice-over Cuso made, a file he wrote, work he handed to a Coworker (task) or to a hired Agent (agent), a table, a contact list or lookup (contacts), a background run, a question to a Coworker, a check he asked of the SEO specialist (seo), or the SEO specialist's weekly audit of the site (audit).",
      ),
    state: z
      .enum(["making", "waiting", "ready", "failed", "stopped"])
      .describe(
        "making until it is done; waiting when handed work needs the owner; failed when it never will be done; stopped when a background run was called off.",
      ),
    at: dateTimeSchema.describe("When Cuso started it."),
    title: z
      .string()
      .describe(
        "What it is: the prompt, the words spoken, the file's or the work's name.",
      ),
    url: z
      .union([z.string(), z.null()])
      .describe("Where the finished file plays or downloads from."),
    by: z
      .union([z.string(), z.null()])
      .describe("Who does handed work: the Coworker or the Agent."),
    text: z
      .union([z.string(), z.null()])
      .describe(
        "Handed work: what is asked while it waits, the start of the result once done.",
      ),
    readable: z
      .boolean()
      .describe("Its full words are at /chat-work/{id}/text."),
    files: z
      .array(z.object({ name: z.string(), url: z.string() }))
      .describe("Files handed work came back with."),
    table: z
      .union([cmoChatTableSchema, z.null()])
      .describe("A table's columns and first rows."),
    people: z
      .array(
        z.object({
          name: z.string(),
          detail: z.union([z.string(), z.null()]),
        }),
      )
      .describe("The first people of a contact list or a lookup."),
    total: z
      .union([z.number().int(), z.null()])
      .describe("Everyone that list or lookup holds, shown or not."),
    steps: z
      .array(
        z.object({
          label: z.string(),
          state: z.enum(["done", "now", "next"]),
        }),
      )
      .describe("A running background run's plan."),
    turnId: z
      .union([z.string(), z.null()])
      .describe(
        "A background run's own turn: its report in the room is this card.",
      ),
  })
  .openapi("CmoChatWorkItem");

export const cmoChatWorkTableSchema = z
  .object({ title: z.string(), table: cmoChatTableSchema })
  .openapi("CmoChatWorkTable");

export const cmoChatWorkSchema = z
  .object({ items: z.array(cmoChatWorkItemSchema) })
  .openapi("CmoChatWork");

export const cmoChatWorkIdParamsSchema = cmoProjectParamsSchema.extend({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: "id", in: "path" } }),
});

/** A report is its card's message in Cuso's shared room. */
export const cmoReportIdParamsSchema = z.object({ id: z.string().uuid() });

export const cmoMediaItemSchema = z
  .object({
    kind: z.enum(["image", "video"]),
    url: z.string(),
    name: z.string(),
  })
  .openapi("CmoMediaItem");

export const cmoDraftSchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    text: z.string(),
    status: z
      .string()
      .describe(
        "The Social post's status. NEEDS_APPROVAL waits for the owner; SCHEDULED goes out at scheduledAt.",
      ),
    revision: z.number().int(),
    scheduledAt: z.union([dateTimeSchema, z.null()]),
    publishedUrl: z.union([z.string(), z.null()]),
    media: z.array(cmoMediaItemSchema),
  })
  .openapi("CmoDraft");

export const cmoDraftParamsSchema = cmoProjectParamsSchema.extend({
  postId: z
    .string()
    .uuid()
    .openapi({ param: { name: "postId", in: "path" } }),
});

export const cmoDraftRevisionSchema = z
  .object({
    revision: z
      .number()
      .int()
      .describe("The draft's revision as shown; a changed draft is refused."),
  })
  .openapi("CmoDraftRevision");

export const cmoDraftApproveSchema = cmoDraftRevisionSchema
  .extend({
    tikTokSettings: tikTokPostSettingsSchema
      .optional()
      .describe(
        "A TikTok video only: who sees it, what viewers may do, and the owner's confirmation of this video (`previewConsent`) and of TikTok's Music Usage Confirmation. Required for TikTok, which posts the video at once.",
      ),
  })
  .openapi("CmoDraftApprove");

export const cmoTikTokCreatorSchema = z
  .object({
    creator_nickname: z.string(),
    privacy_level_options: z
      .array(z.string())
      .describe(
        "The audiences TikTok allows now. Empty: no post is possible right now.",
      ),
    comment_disabled: z.boolean(),
    duet_disabled: z.boolean(),
    stitch_disabled: z.boolean(),
    max_video_post_duration_sec: z.number().int(),
  })
  .openapi("CmoTikTokCreator");

export const cmoDraftEditSchema = cmoDraftRevisionSchema
  .extend({ text: z.string().trim().min(1).max(25_000) })
  .openapi("CmoDraftEdit");

export const cmoUpdateSchema = cmoReportUpdateInputSchema
  .extend({
    id: z.string(),
    at: dateTimeSchema,
    revertible: z.boolean(),
    revertedAt: z.union([dateTimeSchema, z.null()]),
    posts: z
      .array(cmoDraftSchema)
      .describe("The Social posts the report's turn made, as they are now."),
    media: z
      .array(cmoMediaItemSchema)
      .describe(
        "Pictures and videos the report's turn made that are on none of its posts.",
      ),
  })
  .openapi("CmoUpdate");

export const cmoChannelSchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    handle: z.union([z.string(), z.null()]),
    displayName: z.union([z.string(), z.null()]),
    status: z.string(),
    personalProfile: z
      .boolean()
      .describe(
        "A LinkedIn connection that posts as the person, not as a company Page.",
      ),
  })
  .openapi("CmoChannel");

export const cmoFinalizeSocialConnectionRequestSchema =
  finalizeProjectSocialConnectionRequestSchema
    .extend({
      pendingDataToken: z.string().min(1).max(512).optional().openapi({
        description:
          "Returned with a LinkedIn sign-in: names the Pages it reaches.",
      }),
      connectToken: z.string().min(1).max(4096).optional().openapi({
        description: "Returned with a LinkedIn sign-in: lets Core finish it.",
      }),
      externalAccountId: z.string().min(1).max(256).optional().openapi({
        description:
          "The Page or profile the owner picked among the sign-in's accounts.",
      }),
    })
    .openapi("CmoFinalizeSocialConnectionRequest");

export const cmoSocialAccountChoiceSchema = z
  .object({
    externalAccountId: z.string(),
    name: z.string(),
    handle: z.union([z.string(), z.null()]),
    kind: z.enum(["page", "profile"]),
  })
  .openapi("CmoSocialAccountChoice");

export const cmoSocialConnectionFinalizedSchema = z
  .object({
    state: z
      .enum(["connected", "choose"])
      .describe(
        "`choose`: the sign-in reaches several accounts; finalize again with the owner's pick.",
      ),
    choices: z.array(cmoSocialAccountChoiceSchema),
  })
  .openapi("CmoSocialConnectionFinalized");

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

export const cmoActivitySchema = z
  .object({
    step: z
      .union([z.string(), z.null()])
      .describe(
        'The step Cuso is on, in CMO\'s words ("Looking for a picture style"); null before his first one.',
      ),
    reasoning: z
      .union([z.string(), z.null()])
      .describe(
        "The model's latest summary of its reasoning in this turn; null when it gave none.",
      ),
  })
  .openapi("CmoActivity");

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
          fullUrl: z
            .union([z.string(), z.null()])
            .describe("The page from the top, several screens down."),
        }),
      )
      .describe(
        "The brand's own pages Cuso read, home first, each on a desktop and then on a phone.",
      ),
    sections: z
      .array(
        cmoMediaFileSchema.extend({
          kind: z.enum([
            "hero",
            "pricing",
            "testimonials",
            "customers",
            "faq",
            "product",
            "features",
            "cta",
            "section",
          ]),
          /** The section's heading, or its first words. */
          title: z.string(),
          pageLabel: z.string(),
          pageUrl: z.string(),
        }),
      )
      .describe(
        "Each page cut into its sections, in page order: the hero, pricing cards, testimonials, customer logos, product shots, feature grids, the closing call to action.",
      ),
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
    subscriptionActive: z
      .boolean()
      .describe(
        "Whether Cuso may work: his Project has an active CMO subscription (a scheduled cancel counts until the period ends), he is still in free hiring, or he holds Tester credits that are not used up. False means paused, even when the Organization credit pool has credits; `billing.status` says whether a payment failed.",
      ),
    viewerCanApprove: z
      .boolean()
      .describe(
        "Whether this member may approve the strategy: the organization's owners and admins only. Every other member works with Cuso but cannot.",
      ),
    work: z.union([cmoWorkSchema, z.null()]),
    activity: z
      .union([cmoActivitySchema, z.null()])
      .describe(
        "What Cuso is doing in the turn he runs now, whatever started it (a chat message, hiring, a rhythm, the month's production); null while he rests.",
      ),
    brandVisual: z.union([cmoBrandVisualSchema, z.null()]),
    projectLogo: z.union([z.string(), z.null()]),
    /** The owner gave their photo, with consent, to front talking videos. */
    presenterSet: z.boolean(),
    onboardingStep: z
      .enum(CMO_ONBOARDING_STEPS)
      .describe(
        "Where Hiring Cuso stands, read from the data: the Brand Brain until a member confirms it, the strategy until a version is approved, the checkout until his Project has a CMO subscription (or Tester credits), then the accounts until the Project has a Social connection. CMO opens on the chat once done.",
      ),
    routines: z.array(cmoRoutineSchema),
    timeZone: z
      .string()
      .describe("The time zone Cuso's routines run in, as the owner set it."),
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
    postRevisions: z
      .record(z.string(), z.number().int())
      .describe(
        "The revision of each Social post of the month, by post id: what an owner's edit of its words names (PATCH drafts/{postId}).",
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
    drafts: z
      .array(cmoDraftSchema)
      .describe(
        "Social posts Cuso made that wait for the owner's approval, newest first.",
      ),
    channels: z.array(cmoChannelSchema),
    upNext: z.array(cmoUpNextItemSchema),
    connectChannelUrl: z.string(),
    tiktokEnabled: z
      .boolean()
      .describe(
        "TikTok may be connected to this Cuso's Project. Cuso plans no TikTok posts yet.",
      ),
    adProviders: z.array(z.string()),
    measurement: z
      .array(cmoMeasurementSchema)
      .describe(
        "Where Cuso reads the funnel's numbers: Google Analytics, Search Console and Shopify.",
      ),
    production: cmoProductionSchema.describe(
      "After approval Cuso makes the whole month at once: how many of its pieces are made.",
    ),
    mailingListSize: z.number().int(),
    billing: z
      .object({
        tier: z
          .union([z.string(), z.null()])
          .describe("The CMO plan's tier, as its Polar product names it."),
        interval: z.union([z.enum(["month", "year"]), z.null()]),
        status: z
          .union([z.string(), z.null()])
          .describe("Polar's subscription status, as sent."),
        periodEnd: z.union([dateTimeSchema, z.null()]),
        cancelAtPeriodEnd: z.boolean(),
        pendingTier: z
          .union([z.string(), z.null()])
          .describe("The tier a scheduled downgrade moves to at period end."),
        availableCredits: z.number(),
        viewerCanManage: z
          .boolean()
          .describe(
            "Whether this member may change the plan and open the customer portal: the organization's owners and admins only.",
          ),
        hasTesterCredits: z
          .boolean()
          .describe(
            "This Cuso was granted Tester credits (by a tester, or at a hire before CMO plans), spent or not, so his hiring ends without a checkout.",
          ),
        maySkipSubscription: z
          .boolean()
          .describe(
            "The caller is on CMO_SUBSCRIPTION_SKIP_ALLOWLIST and nothing pays for this Cuso (no active CMO subscription, no Tester credits left): CMO offers to continue without a subscription.",
          ),
      })
      .describe(
        "Cuso's CMO plan, read from his Project's CMO subscription that has not ended; the plan fields are null without one.",
      ),
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
