import {
  CMO_CHANNELS,
  isCmoChannelFormat,
  normalizeCmoChannelFormat,
} from "@sokosumi/utils";
import { z } from "zod";

/**
 * CMO.xyz (Cuso): the marketing profile of a Soko Bot. A Cuso bot is an
 * ordinary Soko Bot pinned to a `cmo-*` version; what makes it Cuso is its
 * version's profile, its skills, the two tools below, and the CMO rhythms.
 * Its Brand Brain and Strategy are typed records Core keeps per CMO
 * workspace; the CMO app and the bot read and write the same shapes.
 */

const shortText = z.string().trim().min(1).max(400);
const longText = z.string().trim().min(1).max(2_000);
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

/** What each section answers, for Cuso's skill and the live research feed. */
export const CMO_BRAND_SECTIONS: Record<
  CmoBrandSectionKey,
  { title: string; covers: string }
> = {
  company: {
    title: "Company basics",
    covers:
      "name, website, headquarters, markets served, founding year, ownership, size, locations, languages, business stage",
  },
  offer: {
    title: "Products and services",
    covers:
      "what they sell, categories, main features, included services, flagship offering, use cases, integrations, requirements to use it",
  },
  problems: {
    title: "Customer problems",
    covers:
      "problems solved, how customers cope today, cost of leaving them unsolved, desired outcomes, events that trigger a purchase",
  },
  customers: {
    title: "Target customers",
    covers:
      "B2B or B2C, industries, company sizes, geographies, budgets, customer maturity, the most valuable segments",
  },
  buyers: {
    title: "Buyers and users",
    covers:
      "who uses it, who researches, who influences, who approves the budget, who can block the purchase; for B2B job titles, departments, responsibilities, goals",
  },
  value: {
    title: "Value proposition",
    covers:
      "main promise, practical benefits, measurable results, differentiation, reasons to choose them, reasons customers hesitate",
  },
  pricing: {
    title: "Pricing and business model",
    covers:
      "prices, packages, subscription or one-off, usage fees, contract lengths, free trials, discounts, upsells, public or negotiated",
  },
  positioning: {
    title: "Positioning and messaging",
    covers:
      "how they describe themselves, category, tagline, key messages, tone, recurring claims, whether messaging changes by audience",
  },
  competition: {
    title: "Competitors and alternatives",
    covers:
      "direct competitors, indirect alternatives, in-house solutions, doing nothing, relative pricing, strengths and weaknesses, switching barriers",
  },
  sales: {
    title: "Sales process",
    covers:
      "self-serve or sales-led, purchase steps, demos, consultations, onboarding, likely cycle length, procurement, common objections",
  },
  marketing: {
    title: "Marketing and distribution",
    covers:
      "search, social, paid ads, email, events, partnerships, referrals, marketplaces, resellers, which channels are active or important",
  },
  content: {
    title: "Content and search",
    covers:
      "main website topics, target keywords, useful landing pages, blog themes, publishing frequency, lead magnets, FAQs, content per buying stage",
  },
  proof: {
    title: "Customer evidence",
    covers:
      "named customers, case studies, testimonials, independent reviews, reported results, recurring praise and complaints, repeat business",
  },
  reputation: {
    title: "Brand and reputation",
    covers:
      "visual identity, personality, perceived expertise, press, community, public sentiment, trust signals such as certifications or awards",
  },
  momentum: {
    title: "Strategy and momentum",
    covers:
      "recent launches, hiring, funding, acquisitions, partnerships, expansion, leadership statements, apparent priorities",
  },
  opportunities: {
    title: "Constraints and opportunities",
    covers:
      "regulation, operational limits, seasonality, customer concentration, underserved segments, messaging gaps, openings competitors overlook",
  },
};

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

/**
 * What the owner can connect so Cuso measures the funnel instead of
 * estimating it. Ids are Composio toolkit slugs.
 */
export const CMO_MEASUREMENT_SOURCES = [
  {
    id: "google_analytics",
    name: "Google Analytics",
    measures: "Visits, where they come from and conversions",
  },
  {
    id: "google_search_console",
    name: "Google Search Console",
    measures: "Searches, clicks and rankings",
  },
  { id: "shopify", name: "Shopify", measures: "Orders and revenue" },
] as const;
export type CmoMeasurementSource =
  (typeof CMO_MEASUREMENT_SOURCES)[number]["id"];

export function isCmoMeasurementSource(
  value: string,
): value is CmoMeasurementSource {
  return CMO_MEASUREMENT_SOURCES.some((source) => source.id === value);
}

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

export const cmoBrandBrainSchema = z.object({
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
export type CmoBrandBrain = z.infer<typeof cmoBrandBrainSchema>;

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

export const cmoStrategySchema = z.object({
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
export type CmoStrategy = z.infer<typeof cmoStrategySchema>;

/**
 * Sections as they are finished, the essentials last: each save merges into
 * the stored Brand Brain, and the owner sees it once the essentials exist.
 */
export const cmoSaveBrandBrainInputSchema = z
  .object({
    brandBrain: cmoBrandBrainSchema.optional(),
    sections: cmoBrandProfileSchema.optional(),
  })
  .refine((input) => input.brandBrain || input.sections, {
    message: "Send brandBrain, sections, or both",
  });
export type CmoSaveBrandBrainInput = z.input<
  typeof cmoSaveBrandBrainInputSchema
>;
/**
 * What Cuso saves: only channels and formats he can run today. Reading a
 * stored strategy stays lenient so older plans still show.
 */
/** Older channel and format names, mapped to the catalog before the check. */
function normalizeStrategyChannels(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const strategy = value as {
    channels?: unknown;
    calendar?: unknown;
  };
  const channels = Array.isArray(strategy.channels)
    ? strategy.channels.map((channel) =>
        channel && typeof channel === "object" && "channel" in channel
          ? {
              ...channel,
              channel: normalizeCmoChannelFormat(String(channel.channel), "")
                .channel,
            }
          : channel,
      )
    : strategy.channels;
  const calendar = Array.isArray(strategy.calendar)
    ? strategy.calendar.map((entry) =>
        entry &&
        typeof entry === "object" &&
        "channel" in entry &&
        "format" in entry
          ? {
              ...entry,
              ...normalizeCmoChannelFormat(
                String(entry.channel),
                String(entry.format),
              ),
            }
          : entry,
      )
    : strategy.calendar;
  return { ...strategy, channels, calendar };
}

/**
 * A save sends only the parts it changes; what it leaves out stays as stored.
 * A long plan goes in short calls (the strategy, then its calendar), each
 * well inside one model answer.
 */
const cmoStrategySaveSchema = cmoStrategySchema.partial();
export type CmoStrategySave = z.input<typeof cmoStrategySaveSchema>;

/**
 * What a save replaces: the plan (every field but the calendar), the
 * calendar alone, or all of it. A long plan goes in two short calls; the
 * part keeps the fields a call must still fill in from replacing the saved
 * ones.
 */
/** clientTurnId prefix of the run that makes the month after payment. */
export const CMO_PRODUCTION_TURN_PREFIX = "cmo:production:";

/** Media one production run may start: a month of pieces, not a chat's few. */
export const CMO_PRODUCTION_MEDIA_PER_RUN = { images: 60, videos: 10 };

/**
 * plan: every field but the calendar; calendar: the whole calendar; pieces:
 * only the calendar entries sent, merged by id (new ids are added, none is
 * dropped); all: everything.
 */
export const CMO_STRATEGY_SAVE_PARTS = [
  "plan",
  "calendar",
  "pieces",
  "all",
] as const;
export type CmoStrategySavePart = (typeof CMO_STRATEGY_SAVE_PARTS)[number];

export const cmoSaveStrategyInputSchema = z.object({
  part: z.enum(CMO_STRATEGY_SAVE_PARTS).default("all"),
  strategy: z
    .preprocess(normalizeStrategyChannels, cmoStrategySaveSchema)
    .superRefine((strategy, ctx) => {
      const live = Object.entries(CMO_CHANNELS)
        .filter(([, channel]) => channel.status === "live")
        .map(
          ([key, channel]) =>
            `${key} (${Object.keys(channel.formats).join(", ")})`,
        )
        .join("; ");
      const planned = new Set(
        (strategy.channels ?? []).map((channel) => channel.channel),
      );
      (strategy.proposals ?? []).forEach((proposal, index) => {
        const entry = (CMO_CHANNELS as Record<string, { status: string }>)[
          proposal.channel
        ];
        if (entry?.status !== "live" || planned.has(proposal.channel)) {
          ctx.addIssue({
            code: "custom",
            path: ["proposals", index, "channel"],
            message: `Propose only a channel Cuso runs today that the plan does not use yet: ${live}`,
          });
        }
      });
      (strategy.channels ?? []).forEach((channel, index) => {
        const entry = (CMO_CHANNELS as Record<string, { status: string }>)[
          channel.channel
        ];
        if (entry?.status !== "live") {
          ctx.addIssue({
            code: "custom",
            path: ["channels", index, "channel"],
            message: `Use a channel Cuso runs today: ${live}`,
          });
        }
      });
      (strategy.calendar ?? []).forEach((entry, index) => {
        // Skipped entries from older plans may name retired formats.
        if (
          entry.status !== "skipped" &&
          !isCmoChannelFormat(entry.channel, entry.format)
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["calendar", index],
            message: `"${entry.channel}" / "${entry.format}" is not something Cuso makes. Use one of: ${live}`,
          });
        }
      });
    }),
});

/**
 * What Cuso reports after a daily run, a weekly review, or a request the
 * owner made in chat. CMO shows each one as a card in the chat.
 */
export const cmoReportUpdateInputSchema = z.object({
  kind: z.enum([
    "daily",
    "weekly",
    "monthly",
    "brand",
    "request",
    "production",
  ]),
  headline: shortText,
  done: z.array(shortText).max(12).default([]),
  /** Concrete next actions only, never status notes such as "awaiting approval". */
  upNext: z.array(shortText).max(12).default([]),
  /** Weekly and monthly: what changed in the strategy; brand: in the Brand Brain. */
  changes: z.array(shortText).max(10).default([]),
  /** Weekly: what the numbers say, or plainly that there are none yet. */
  results: longText.optional(),
});
export type CmoReportUpdateInput = z.infer<typeof cmoReportUpdateInputSchema>;

/**
 * Whether Cuso may schedule or publish. The owner approves the strategy once;
 * after that Cuso executes on its own, as long as the CMO subscription is
 * active.
 */
export function cmoMayExecute(input: {
  approved: boolean;
  subscribed: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.approved) {
    return {
      ok: false,
      reason:
        "The owner has not approved the strategy yet. Keep it as a draft and point them to the strategy card.",
    };
  }
  if (!input.subscribed) {
    return {
      ok: false,
      reason:
        "Scheduling and publishing start once the owner subscribes to CMO. Keep it as a draft and say so.",
    };
  }
  return { ok: true };
}

export interface CmoSystemSchedule {
  key:
    | "cmo-daily-run"
    | "cmo-weekly-review"
    | "cmo-monthly-strategy"
    | "cmo-brand-refresh"
    | "cmo-strategy-nudge";
  name: string;
  /** When it runs, in words, for the owner's Settings page. */
  when: string;
  cronExpression: string;
  description: string;
  prompt: string;
}

/**
 * Cuso's routines. They all revolve around the strategy: every one reads it
 * and reports against it. Before the owner approves the strategy nothing
 * executes; Core skips the runs (see the CMO beat packet), and at most one
 * nudge reminds the owner. Cuso never gets a personal assistant's rhythms
 * (stand-up, meeting prep, inbox checks).
 */
export const SOKO_BOT_CMO_SCHEDULES: readonly CmoSystemSchedule[] = [
  {
    key: "cmo-daily-run",
    name: "Daily marketing run",
    when: "Every day at 09:00",
    cronExpression: "0 9 * * *",
    description:
      "Keeps the made month current: finishes anything missing, replies to comments, and adjusts pieces for news, holidays and competitors.",
    prompt:
      "Daily marketing run, following your daily watch skill. The month is already made and scheduled; today you keep it right. Using the packet below (Brand Brain, approved strategy, the next days of the calendar, connected channels, recent posts): 1) finish any entry due in the next 3 days that still lacks its draft, its image or video, or its schedule on a connected network, and schedule finished drafts on any network connected since, the way your production skill makes a piece; save with save_strategy part pieces (only those entries: status, socialPostId, imageFileId, slideFileIds); 2) then the reply round (reading comments locks social changes and pictures for the rest of this run, so it comes after them): list_social_comments, then handle_social_comment for each one, following your comment replies skill; 3) last, the news check from your daily watch skill: holidays, competitors and the market. When something passes the bar, change the calendar with save_strategy part pieces (a new or changed entry with status idea, a brief and a why that names the news); the production run makes and schedules it within the hour; 4) report with report_update kind daily: what you did today, how many comments you answered, any comment that needs the owner (who wrote it and what about), each calendar change the news called for under changes with its reason, and what is up next. Create a Task for a Coworker only for work you cannot do well yourself. Then write one short sentence for the owner (the card carries the details). When nothing is due, no comment came in and the news changes nothing, answer exactly: Nothing to add.",
  },
  {
    key: "cmo-weekly-review",
    name: "Weekly review",
    when: "Mondays at 09:00",
    cronExpression: "0 9 * * 1",
    description:
      "Measures last week with real numbers only and improves the strategy. Revertible.",
    prompt:
      "Weekly marketing review. Using the packet below and list_social_posts or get_social_post where needed: what was published last week and how it performed. Use only numbers you actually have; when there are none, say so plainly and never estimate. Then improve the strategy with save_strategy: your changes become a new version, which the owner approves before it runs (the approved plan keeps running until then). Report with report_update kind weekly: results, and each change you made. The owner can go back from the card. Then write one short sentence for the owner; the card carries the details.",
  },
  {
    key: "cmo-monthly-strategy",
    name: "Next month's strategy",
    when: "On the 27th at 09:00",
    cronExpression: "0 9 27 * *",
    description:
      "Writes next month's strategy from what worked and what changed, then keeps executing. Revertible.",
    prompt:
      "Monthly strategy. Next month starts soon. Using the packet below (Brand Brain, the current strategy and calendar, the posts of the last weeks and their results), write next month's strategy with save_strategy: set month to next month, keep the calendar entries still due this month, and plan all of next month. Build on what worked, drop what did not, and reflect what changed in the business. Use only numbers you actually have. Keep the goals unless the owner changed them. Then report with report_update kind monthly: a headline, results (honest, no estimates), and in changes each difference from this month's strategy. Your plan becomes a new version: the owner approves it before it runs, and the approved plan keeps running until then. They can change it in chat or go back from the card. Then write one short sentence for the owner.",
  },
  {
    key: "cmo-brand-refresh",
    name: "Brand Brain refresh",
    when: "On the 15th at 08:00",
    cronExpression: "0 8 15 * *",
    description:
      "Re-reads the website and updates the Brand Brain with what changed.",
    prompt:
      "Brand Brain refresh. Re-read the business's website (home, about, products, pricing) and search for recent news about the company. Compare with the Brand Brain in the packet below. If something changed (new product, new pricing, new audience, new claims, a launch, a hire, a funding round), save only the changed profile sections with save_brand_brain, plus the essentials when they change, then report with report_update kind brand: a headline and each change in changes. Write down only what you found. When nothing changed, answer exactly: Nothing to add.",
  },
  {
    key: "cmo-strategy-nudge",
    name: "Strategy reminder",
    when: "Once, two days after a strategy waits for approval",
    cronExpression: "0 10 * * *",
    description:
      "One friendly reminder when the proposed strategy has waited about two days.",
    prompt:
      "Strategy reminder. The strategy you proposed has waited about two days for the owner's approval, and nothing runs until they approve it. Write one or two friendly sentences in the brand's language: what the plan does first, and that one click on Approve strategy (or a change request in chat) gets you started. Do not call tools. Do not repeat the whole plan.",
  },
];

/** Routines that do work and so wait for the owner's approval. */
const CMO_EXECUTING_KEYS: ReadonlySet<CmoSystemSchedule["key"]> = new Set([
  "cmo-daily-run",
  "cmo-weekly-review",
  "cmo-monthly-strategy",
]);

const NUDGE_AFTER_MS = 48 * 60 * 60 * 1_000;
const NUDGE_UNTIL_MS = 72 * 60 * 60 * 1_000;

/**
 * Whether a routine has a reason to run now. Executing routines wait for the
 * approved strategy; the refresh needs a Brand Brain; the reminder runs only
 * in the one daily slot 48–72 hours after an unapproved strategy was saved,
 * so the owner gets it at most once per proposal.
 */
export function cmoRoutineSkipReason(
  key: CmoSystemSchedule["key"],
  state: {
    brandBrain: boolean;
    strategySavedAt: Date | null;
    strategyApproved: boolean;
    now: Date;
  },
): string | null {
  if (CMO_EXECUTING_KEYS.has(key)) {
    return state.strategyApproved ? null : "strategy not approved yet";
  }
  if (key === "cmo-brand-refresh") {
    return state.brandBrain ? null : "no Brand Brain yet";
  }
  if (!state.strategySavedAt || state.strategyApproved) {
    return "no strategy waiting";
  }
  const waited = state.now.getTime() - state.strategySavedAt.getTime();
  return waited >= NUDGE_AFTER_MS && waited < NUDGE_UNTIL_MS
    ? null
    : "not the reminder slot";
}

export function isCmoScheduleKey(
  key: string | null | undefined,
): key is CmoSystemSchedule["key"] {
  return SOKO_BOT_CMO_SCHEDULES.some((schedule) => schedule.key === key);
}

/**
 * The fields a save_strategy call replaces. Tool calls must fill every field,
 * often with empty lists, so only the fields of the named part are taken.
 */
/** Which part a save_strategy call replaces; see CMO_STRATEGY_SAVE_PARTS. */
export function cmoStrategySavePart(input: unknown): CmoStrategySavePart {
  const part = (input as { part?: unknown } | null)?.part;
  return CMO_STRATEGY_SAVE_PARTS.includes(part as CmoStrategySavePart)
    ? (part as CmoStrategySavePart)
    : "all";
}

export function parseCmoStrategySave(input: unknown): CmoStrategySave {
  const raw = (input ?? {}) as { part?: unknown; strategy?: unknown };
  const sent = (
    raw.strategy && typeof raw.strategy === "object" ? raw.strategy : {}
  ) as Record<string, unknown>;
  // The other part's fields are filler; they are dropped before checking.
  const { calendar, ...plan } = sent;
  const picked =
    raw.part === "calendar" || raw.part === "pieces"
      ? { calendar }
      : raw.part === "plan"
        ? plan
        : sent;
  const { part, strategy } = cmoSaveStrategyInputSchema.parse({
    ...raw,
    strategy: picked,
  });
  if (part === "calendar" || part === "pieces")
    return { calendar: strategy.calendar ?? [] };
  if (part === "plan") {
    const { calendar: _calendar, ...rest } = strategy;
    return rest;
  }
  return strategy;
}
