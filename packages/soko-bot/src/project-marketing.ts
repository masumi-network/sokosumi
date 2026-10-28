import { z } from "zod";

/**
 * The JSON shapes of a Project's Brand Brain, a Marketing strategy version's
 * plan and a Social post's planning (ADR 0062). Sokosumi validates every
 * write with them; CMO's Cuso is one writer among the Project's bots.
 */

export const shortText = z.string().trim().min(1).max(400);
export const longText = z.string().trim().min(1).max(2_000);
/** A finished post, article excerpt or email, ready to publish. */
const draftText = z.string().trim().min(1).max(4_000);

/**
 * The company profile behind the Brand Brain, one section per question a
 * marketer asks about a business. Keys only; CMO names them.
 */
export const CMO_BRAND_SECTION_KEYS = [
  "company",
  "offer",
  "problems",
  "customers",
  "buyers",
  "value",
  "pricing",
  "positioning",
  "competition",
  "sales",
  "marketing",
  "content",
  "proof",
  "reputation",
  "momentum",
  "opportunities",
] as const;
export type CmoBrandSectionKey = (typeof CMO_BRAND_SECTION_KEYS)[number];

export const cmoBrandFindingSchema = z.object({
  /** What is true, in one sentence. */
  point: shortText,
  /** fact: confirmed by a source; claim: the company says so; inference: Cuso's reading. */
  evidence: z.enum(["fact", "claim", "inference"]),
  confidence: z.enum(["high", "medium", "low"]),
  sourceUrl: z.string().url().max(500).optional(),
  /** How recent the source is, YYYY-MM or YYYY-MM-DD. */
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}(-\d{2})?$/, "Use YYYY-MM or YYYY-MM-DD")
    .optional(),
  /** What it means for marketing, sales or strategy. */
  implication: shortText.optional(),
});
export type CmoBrandFinding = z.infer<typeof cmoBrandFindingSchema>;

export const cmoBrandSectionSchema = z.object({
  /** The answer at a glance, at most eight words. */
  headline: z.string().trim().min(1).max(80).optional(),
  /** The section's answer in one or two sentences. */
  answer: shortText,
  /** Left out or empty on a save, the stored findings stay. */
  findings: z.array(cmoBrandFindingSchema).max(6).default([]),
  /** What still needs the owner or a source to confirm. */
  openQuestions: z.array(shortText).max(3).default([]),
});
export type CmoBrandSection = z.infer<typeof cmoBrandSectionSchema>;

const section = cmoBrandSectionSchema.optional();
export const cmoBrandProfileSchema = z.object({
  company: section,
  offer: section,
  problems: section,
  customers: section,
  buyers: section,
  value: section,
  pricing: section,
  positioning: section,
  competition: section,
  sales: section,
  marketing: section,
  content: section,
  proof: section,
  reputation: section,
  momentum: section,
  opportunities: section,
} satisfies Record<CmoBrandSectionKey, typeof section>);
export type CmoBrandProfile = z.infer<typeof cmoBrandProfileSchema>;

const mapLabel = z.string().trim().min(1).max(40);

/**
 * The first thing the owner sees: what Cuso would put on the cover of a
 * brand book. Short on purpose; the profile holds the evidence.
 */
export const cmoBrandRevealSchema = z.object({
  /** The business's position in one line, at most twelve words. */
  positioning: z.string().trim().min(1).max(120),
  /** The three things a marketer would not have guessed. */
  insights: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(60),
        detail: z.string().trim().min(1).max(200),
        sourceUrl: z.string().url().max(500).optional(),
      }),
    )
    .max(3),
  /** Where the business sits against its competitors on two axes. */
  map: z
    .object({
      x: z.object({ low: mapLabel, high: mapLabel }),
      y: z.object({ low: mapLabel, high: mapLabel }),
      players: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(40),
            x: z.number().min(0).max(100),
            y: z.number().min(0).max(100),
            you: z.boolean().optional(),
          }),
        )
        .min(2)
        .max(6),
    })
    .optional(),
  /** The people who buy, each in a few words. */
  buyers: z
    .array(
      z.object({
        role: z.string().trim().min(1).max(50),
        wants: z.string().trim().min(1).max(120),
        worry: z.string().trim().min(1).max(120),
      }),
    )
    .max(3),
});
export type CmoBrandReveal = z.infer<typeof cmoBrandRevealSchema>;

/** How a number was found: read from a source, Cuso's estimate, or not known. */
export const CMO_MEASURE_BASES = ["measured", "estimated", "unknown"] as const;

/**
 * The business's marketing as it is before Cuso: what it posts where and how
 * often, its site and its ads. The strategy shows its plan against this.
 */
export const cmoMarketingTodaySchema = z.object({
  /** In one line: "LinkedIn product news twice a month, no ads, blog quiet". */
  summary: shortText,
  channels: z
    .array(
      z.object({
        /** The network, as the channels list names it ("Instagram"). */
        name: shortText,
        url: z.string().url().max(500).optional(),
        /** As the network shows it: "511K". */
        followers: z.string().trim().max(20).optional(),
        /** Posts in the last 30 days, counted or estimated. */
        postsPerMonth: z.number().int().min(0).max(10_000).optional(),
        /** The newest post: a date or "2 weeks ago". */
        lastPost: z.string().trim().max(40).optional(),
        formats: z.array(z.string().trim().min(1).max(40)).max(4).default([]),
        themes: z.array(z.string().trim().min(1).max(60)).max(4).default([]),
        basis: z.enum(CMO_MEASURE_BASES),
      }),
    )
    .max(10)
    .default([]),
  website: z
    .object({
      /** How often it publishes: "About two posts a month", "No blog". */
      blog: shortText.optional(),
      /** It offers a newsletter signup. */
      newsletter: z.boolean().optional(),
      /** What the site does well or misses for search and conversion. */
      notes: z.array(shortText).max(4).default([]),
    })
    .optional(),
  ads: z
    .object({
      status: z.enum(["running", "none_found", "unknown"]),
      note: shortText.optional(),
    })
    .optional(),
});
export type CmoMarketingToday = z.infer<typeof cmoMarketingTodaySchema>;

export const CMO_BRAND_ANSWERS = ["yes", "no", "unsure"] as const;
export type CmoBrandAnswer = (typeof CMO_BRAND_ANSWERS)[number];

export const cmoBrandQuestionSchema = z.object({
  /** Stable, so an answer survives Cuso saving the questions again. */
  id: z.string().trim().min(1).max(40),
  /** Answerable with yes or no, at most fifteen words. */
  question: z.string().trim().min(1).max(160),
  /** What a yes confirms, as one finding sentence for the section. */
  statement: shortText,
  /** The profile section the answer lands in. */
  section: z.enum(CMO_BRAND_SECTION_KEYS),
  answer: z.enum(CMO_BRAND_ANSWERS).optional(),
  /** The owner's own words after a no: what is true instead. */
  note: shortText.optional(),
});
export type CmoBrandQuestion = z.infer<typeof cmoBrandQuestionSchema>;

/** A yes/no check of one plan assumption, answered after the plan; a no changes it. */
export const cmoPlanQuestionSchema = cmoBrandQuestionSchema.omit({
  section: true,
});
export type CmoPlanQuestion = z.infer<typeof cmoPlanQuestionSchema>;

const cmoCompanyLinkSchema = z.object({
  name: shortText,
  url: z.string().url().max(500).optional(),
  note: shortText.optional(),
});

export const brandBrainSchema = z.object({
  /** One paragraph: what the business is and why customers choose it. */
  summary: longText,
  voice: z.object({
    tone: shortText,
    do: z.array(shortText).max(12),
    dont: z.array(shortText).max(12),
    /** Real or approved lines that sound like the brand. */
    examples: z.array(longText).max(8),
  }),
  audience: z.array(shortText).max(8),
  products: z.array(shortText).max(12),
  /** What the business sells, main offer first, with its published price. */
  offers: z
    .array(
      z.object({
        name: shortText,
        /** What it is, in one plain line. */
        what: shortText,
        /** As published ("€9 a month", "From $49", "Free"), "On request" or "Not public". */
        price: shortText,
        forWhom: shortText.optional(),
        url: z.string().url().max(500).optional(),
      }),
    )
    .max(10)
    .default([]),
  competitors: z.array(cmoCompanyLinkSchema).max(10),
  /** Well-known platforms, firms and tools a buyer also weighs, anywhere. */
  alternatives: z.array(cmoCompanyLinkSchema).max(6).default([]),
  channels: z
    .array(
      z.object({
        name: shortText,
        url: z.string().url().max(500).optional(),
        note: shortText.optional(),
      }),
    )
    .max(12),
  profile: cmoBrandProfileSchema.default({}),
  reveal: cmoBrandRevealSchema.optional(),
  /** The marketing as it is today, before Cuso: the strategy's "before". */
  marketingToday: cmoMarketingTodaySchema.optional(),
  /**
   * What research could not settle, as questions the owner answers yes or no
   * after approving the Brand Brain. The answer is the owner's; Cuso only
   * asks.
   */
  questions: z.array(cmoBrandQuestionSchema).max(6).default([]),
});
export type BrandBrain = z.infer<typeof brandBrainSchema>;

export const CMO_CALENDAR_STATUSES = [
  "idea",
  "draft",
  "scheduled",
  "published",
  "skipped",
] as const;

/** The ways social content can work; a plan leads with one or two. */
export const CMO_CONTENT_APPROACHES = [
  "educational",
  "thought-leadership",
  "problem-solution",
  "product-led",
  "social-proof",
  "people-led",
  "community-led",
  "entertainment",
  "research-led",
  "promotional",
] as const;
export type CmoContentApproach = (typeof CMO_CONTENT_APPROACHES)[number];

/** Why people do not buy yet, which decides the mix. */
export const CMO_BUYING_BARRIERS = [
  "awareness",
  "understanding",
  "trust",
] as const;

export const cmoCalendarEntrySchema = z.object({
  /** Stable id Cuso chooses so later saves update the same entry. */
  id: z.string().trim().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  /** When it goes out, HH:MM in the owner's timezone. */
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use HH:MM")
    .optional(),
  /** Lower-case channel key, e.g. linkedin, x, instagram, blog, newsletter. */
  channel: z.string().trim().toLowerCase().min(1).max(40),
  title: shortText,
  /** post, carousel, video, article, newsletter, ad, … */
  format: z.string().trim().min(1).max(40),
  status: z.enum(CMO_CALENDAR_STATUSES),
  /** The opening line or headline the reader sees first. */
  hook: shortText.optional(),
  brief: longText.optional(),
  /** The finished piece, word for word (at least for the first week). */
  draft: draftText.optional(),
  /** Why this piece, on this day and channel, tied to the Brand Brain. */
  why: shortText.optional(),
  socialPostId: z.string().uuid().optional(),
  imageFileId: z.string().max(100).optional(),
  /** A carousel's slides in order, the cover first (also its imageFileId). */
  slideFileIds: z.array(z.string().max(100)).max(10).optional(),
  taskId: z.string().max(100).optional(),
  /** The campaign this piece belongs to, by campaign id. */
  campaignId: z.string().trim().min(1).max(64).optional(),
  /** The content approach this piece takes, one of the plan's mix. */
  approach: z.enum(CMO_CONTENT_APPROACHES).optional(),
  /** The topic (pillar) it covers. */
  pillar: shortText.optional(),
});
export type CmoCalendarEntry = z.infer<typeof cmoCalendarEntrySchema>;

/**
 * What the plan intends with a Social post made from its calendar (ADR
 * 0062): the entry's id and its planning fields. The post itself holds the
 * words, media, network and time.
 */
export const socialPostPlanningSchema = cmoCalendarEntrySchema.pick({
  id: true,
  title: true,
  format: true,
  hook: true,
  brief: true,
  why: true,
  approach: true,
  pillar: true,
  campaignId: true,
});
export type SocialPostPlanning = z.infer<typeof socialPostPlanningSchema>;

/** The funnel's stages, top to bottom. */
export const CMO_FUNNEL_STAGES = [
  "awareness",
  "consideration",
  "conversion",
  "loyalty",
] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const channelKey = z.string().trim().toLowerCase().min(1).max(40);

/** Known from research or the owner, or Cuso's assumption to confirm. */
const CMO_STRATEGY_BASES = ["fact", "assumption"] as const;
const strategyPointSchema = z.object({
  text: shortText,
  basis: z.enum(CMO_STRATEGY_BASES).default("fact"),
});

/** How hard a plan publishes; Cuso recommends one and the owner can switch. */
export const CMO_PACES = ["steady", "active", "all_in"] as const;
export type CmoPace = (typeof CMO_PACES)[number];

/** Who moves a funnel stage: Cuso, the owner (their site, pricing, checkout), or both. */
export const CMO_STAGE_OWNERS = ["cuso", "you", "shared"] as const;

/** Parts of the business the owner controls and Cuso can only suggest changes to. */
export const CMO_IMPROVEMENT_AREAS = [
  "landing",
  "pricing",
  "checkout",
  "site",
  "seo",
  "product",
] as const;

const offerStepSchema = z.object({
  what: shortText,
  why: shortText.optional(),
});

/** The plan's parts besides the calendar, each optional so older plans still read. */
const strategyPlanShape = {
  /**
   * The strategy in one sentence, from four parts: who it targets, how the
   * business is positioned, how people are attracted, and the offer that
   * converts them.
   */
  idea: z
    .object({
      who: shortText,
      position: shortText,
      attract: shortText,
      offer: shortText,
      /** "We'll target busy parents, position our meals as …" */
      sentence: longText,
    })
    .optional(),
  /** Other strategies Cuso weighed for this business; the owner can switch. */
  alternatives: z
    .array(z.object({ sentence: longText, why: shortText }))
    .max(2)
    .default([]),
  /** What starts the funnel, what it sells, and what follows for customers. */
  ladder: z
    .object({
      entry: offerStepSchema.optional(),
      core: offerStepSchema,
      next: offerStepSchema.optional(),
    })
    .optional(),
  /** How much the plan publishes. */
  pace: z
    .object({
      level: z.enum(CMO_PACES),
      why: shortText,
      /** Pieces a week across all channels. */
      perWeek: z.number().int().min(1).max(200),
    })
    .optional(),
  /**
   * Paid ads, the one part that costs the owner more: a monthly amount, what
   * it should bring, and what the plan does without it.
   */
  ads: z
    .object({
      monthly: z.number().min(0).max(10_000_000),
      /** ISO 4217, such as "EUR". */
      currency: z.string().trim().length(3),
      expect: shortText,
      without: shortText,
      /** The owner set the amount; Cuso keeps it. */
      setByOwner: z.boolean().default(false),
    })
    .optional(),
  /** Each channel before Cuso and in this plan, from the Brand Brain's marketing today. */
  beforeAfter: z
    .array(
      z.object({ channel: channelKey, before: shortText, after: shortText }),
    )
    .max(8)
    .default([]),
  /** Changes only the owner can make (their pages, prices, checkout), with why. */
  improvements: z
    .array(
      z.object({
        area: z.enum(CMO_IMPROVEMENT_AREAS),
        idea: shortText,
        why: shortText,
        url: z.string().url().max(500).optional(),
      }),
    )
    .max(6)
    .default([]),
  /** Where marketing stands today: what works, the gaps, what there is to work with. */
  start: z
    .object({
      working: z.array(strategyPointSchema).max(4).default([]),
      gaps: z.array(strategyPointSchema).max(4).default([]),
      /** Budget, people and assets available. */
      resources: z.array(strategyPointSchema).max(4).default([]),
    })
    .optional(),
  /**
   * The one business outcome this month, in words ("More first orders from
   * busy parents"). The numbers live in the funnel; older plans carry a
   * metric and target here.
   */
  objective: z
    .object({
      outcome: shortText.optional(),
      metric: shortText.optional(),
      baseline: shortText.optional(),
      baselineBasis: z.enum(CMO_STRATEGY_BASES).optional(),
      target: shortText.optional(),
      why: shortText.optional(),
    })
    .optional(),
  /** The biggest reason people do not buy yet; it decides the mix. */
  barrier: z
    .object({
      kind: z.enum(CMO_BUYING_BARRIERS),
      /** The barrier in one plain line. */
      text: shortText,
    })
    .optional(),
  /** The content mix: two to four approaches whose shares add up to 100. */
  mix: z
    .array(
      z.object({
        approach: z.enum(CMO_CONTENT_APPROACHES),
        share: z.number().int().min(5).max(100),
        why: shortText,
      }),
    )
    .max(4)
    .default([]),
  /** The one customer segment this month. */
  focus: z
    .object({
      segment: shortText,
      problem: shortText,
      trigger: shortText.optional(),
      objections: z.array(shortText).max(3).default([]),
      where: z.array(shortText).max(4).default([]),
    })
    .optional(),
  offer: z
    .object({
      what: shortText,
      why: shortText,
      proof: z.array(shortText).max(3).default([]),
      /** The one action people should take. */
      action: shortText,
    })
    .optional(),
  campaigns: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        name: shortText,
        message: shortText,
        audience: shortText.optional(),
        offer: shortText.optional(),
        channels: z.array(channelKey).max(4).default([]),
        assets: z.array(shortText).max(6).default([]),
        start: isoDate,
        end: isoDate,
        budget: shortText.optional(),
        metric: shortText,
      }),
    )
    .max(4)
    .default([]),
  /**
   * How a stranger becomes a customer, top to bottom: each stage's job, the
   * channels that do it and the number that shows it works.
   */
  funnel: z
    .array(
      z.object({
        stage: z.enum(CMO_FUNNEL_STAGES),
        /** What people do here, in their words: "Hear about us". */
        name: shortText,
        goal: shortText,
        channels: z.array(channelKey).max(6).default([]),
        metric: shortText,
        target: shortText.optional(),
        /** Who moves this stage; the owner's stages come with improvements. */
        owner: z.enum(CMO_STAGE_OWNERS).optional(),
        /** What each channel does at this stage, and how often. */
        plays: z
          .array(
            z.object({
              channel: channelKey,
              what: shortText,
              cadence: shortText.optional(),
            }),
          )
          .max(6)
          .default([]),
        /** Today's number for the metric, and how it is known. */
        measure: z
          .object({
            value: shortText.optional(),
            basis: z.enum(CMO_MEASURE_BASES),
            /** Where a measured number comes from: "Google Analytics". */
            source: shortText.optional(),
          })
          .optional(),
      }),
    )
    .max(4)
    .default([]),
  /**
   * Channels Cuso runs that this plan leaves out because the owner has no
   * account, list or budget there yet; each runs once the owner adds it.
   */
  proposals: z.preprocess(
    // Proposals saved before they named a channel key are dropped.
    (value) =>
      Array.isArray(value)
        ? value.filter(
            (item) =>
              typeof item === "object" &&
              item !== null &&
              typeof (item as { channel?: unknown }).channel === "string",
          )
        : value,
    z
      .array(
        z.object({
          channel: channelKey,
          why: shortText,
          /** What Cuso would make there: "Image posts of finished dossiers". */
          what: shortText,
          /** Pieces a month once it is added. */
          perMonth: z.number().int().min(1).max(40),
        }),
      )
      .max(3)
      .default([]),
  ),
  /** What happens after the click, step by step, with any fix it needs. */
  journey: z
    .array(z.object({ step: shortText, fix: shortText.optional() }))
    .max(6)
    .default([]),
  weeks: z
    .array(
      z.object({
        focus: shortText,
        tasks: z
          .array(
            z.object({
              task: shortText,
              owner: z.enum(["cuso", "you"]),
              due: isoDate.optional(),
              /** The owner approves or provides something. */
              approval: z.boolean().default(false),
            }),
          )
          .max(6)
          .default([]),
      }),
    )
    .max(5)
    .default([]),
  budget: z
    .object({
      total: shortText,
      basis: z.enum(CMO_STRATEGY_BASES).default("fact"),
      lines: z
        .array(z.object({ item: shortText, amount: shortText }))
        .max(6)
        .default([]),
    })
    .optional(),
  measurement: z
    .object({
      primary: shortText,
      supporting: z.array(shortText).max(4).default([]),
      /** What has to be set up to measure it. */
      tracking: z.array(shortText).max(4).default([]),
      /** When to continue, change or stop an activity. */
      rules: z
        .array(z.object({ when: shortText, then: shortText }))
        .max(4)
        .default([]),
    })
    .optional(),
  /** Older plans: assumptions as open questions. New plans ask `questions`. */
  openQuestions: z.array(shortText).max(5).default([]),
  /** Yes/no checks of the plan's biggest assumptions, asked after the plan. */
  questions: z.array(cmoPlanQuestionSchema).max(5).default([]),
};

/** A sample piece in the strategy proposal, so the owner sees the voice. */
export const cmoPreviewSchema = z.object({
  kind: z.enum(["post", "ad", "seo", "newsletter"]),
  channel: z.string().trim().toLowerCase().min(1).max(40),
  title: shortText,
  body: longText,
});
export type CmoPreview = z.infer<typeof cmoPreviewSchema>;

export const marketingStrategyPlanSchema = z.object({
  /** The month the plan covers, YYYY-MM. */
  month: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM"),
  summary: longText,
  /** Why this plan, for this business: audience, goal, competitors. */
  why: longText.optional(),
  goals: z.array(shortText).min(1).max(6),
  audience: shortText.optional(),
  /** The language posts, ads and emails are written in, named in English ("German"). */
  contentLanguage: shortText.optional(),
  positioning: longText.optional(),
  pillars: z.array(shortText).max(6),
  channels: z
    .array(
      z.object({
        channel: channelKey,
        cadence: shortText,
        /** Why this channel at this cadence, for this audience. */
        why: shortText.optional(),
      }),
    )
    .max(10),
  ...strategyPlanShape,
  calendar: z.array(cmoCalendarEntrySchema).max(120),
  /** Up to one sample each of a post, an ad, an SEO piece, a newsletter. */
  previews: z.array(cmoPreviewSchema).max(4).default([]),
  /** After a change request: what is different from the last version. */
  changes: z.array(shortText).max(10).default([]),
});
export type MarketingStrategyPlan = z.infer<typeof marketingStrategyPlanSchema>;
