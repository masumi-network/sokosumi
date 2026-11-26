import { CMO_VOLUME_LEVELS, SHORT_VIDEO_FORMATS } from "@sokosumi/utils";
import { z } from "zod";

/**
 * The JSON shapes of a Project's Brand Brain, a Marketing strategy version's
 * plan and a Social post's planning (ADR 0062). Sokosumi validates every
 * write with them; CMO's Cuso is one writer among the Project's bots.
 */

/**
 * The kinds of picture a cmo-v11 styled picture is drawn as. The reference
 * lends only its layout, the brand's look sets the rest, and the kind keeps a
 * month from being one flat illustration after another.
 */
export const PICTURE_KINDS = [
  "flat illustration",
  "bold graphic",
  "photographic scene",
  "isometric illustration",
] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

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
  /**
   * The owner's correction: what is true instead, when they asked, and
   * whether the section was rewritten to match it. Set by Core; anything a
   * save sends here is ignored.
   */
  fix: z
    .object({
      /** Every correction waiting on the section, a no's statement with its note included. */
      note: longText,
      /** When the owner asked, as an ISO time. */
      at: z.string().max(40),
      fixed: z.boolean(),
    })
    .optional(),
});

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
  /**
   * The owner's own words: after a no, what is true instead; on a Brand Brain
   * question, details to any answer.
   */
  note: shortText.optional(),
  /**
   * Set by Core on a no: false until the section is rewritten to match it,
   * then true. Anything a save sends here is ignored.
   */
  corrected: z.boolean().optional(),
});
export type CmoBrandQuestion = z.infer<typeof cmoBrandQuestionSchema>;

/** A yes/no check of one plan assumption, answered after the plan; a no changes it. */
export const cmoPlanQuestionSchema = cmoBrandQuestionSchema.omit({
  section: true,
  corrected: true,
});
export type CmoPlanQuestion = z.infer<typeof cmoPlanQuestionSchema>;

const cmoCompanyLinkSchema = z.object({
  name: shortText,
  url: z.string().url().max(500).optional(),
  note: shortText.optional(),
  /** A competitor's headline promise, from its homepage. */
  promise: shortText.optional(),
  /** Its entry price as published, or "Not public". */
  price: shortText.optional(),
  /** What buyers praise it for, from reviews. */
  strength: shortText.optional(),
  /** What buyers complain about, from reviews: where the business can win. */
  weakness: shortText.optional(),
});

/** What a customer's own words tell the marketing. */
export const CMO_CUSTOMER_QUOTE_KINDS = [
  "pain",
  "trigger",
  "outcome",
  "objection",
] as const;

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
  /**
   * Customers' exact words from reviews, forums and the site, so hooks and
   * ads use the buyer's phrasing. Never paraphrased.
   */
  voiceOfCustomer: z
    .array(
      z.object({
        quote: shortText,
        kind: z.enum(CMO_CUSTOMER_QUOTE_KINDS),
        sourceUrl: z.string().url().max(500).optional(),
      }),
    )
    .max(12)
    .optional(),
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

/**
 * The Brand Brain as Core stores and serves it: Cuso's essentials plus what
 * only Core sets. Cuso's save_brand_brain takes `brandBrainSchema`, so a
 * save never sets these.
 */
export const storedBrandBrainSchema = brandBrainSchema.extend({
  /** A member rewrote the promise, so it is their words, not the site's. */
  promiseByOwner: z.boolean().optional(),
});
export type StoredBrandBrainBody = z.infer<typeof storedBrandBrainSchema>;

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

/** Why people do not buy yet, which decides the mix. */
export const CMO_BUYING_BARRIERS = [
  "awareness",
  "understanding",
  "trust",
  "switching",
] as const;

const uniqueIgnoringCase = (texts: readonly string[]) =>
  new Set(texts.map((text) => text.toLowerCase())).size === texts.length;

/**
 * A Google search ad as Cuso writes it, within Google's limits. Core builds
 * the paused campaign from it when the owner launches the piece.
 */
export const cmoSearchAdSchema = z.object({
  keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  headlines: z
    .array(z.string().trim().min(1).max(30))
    .min(3)
    .max(15)
    .refine(uniqueIgnoringCase, "Headlines must differ"),
  descriptions: z.array(z.string().trim().min(1).max(90)).min(2).max(4),
  /** Searches the ad must not show for ("jobs", "free" for a paid-only offer). */
  negativeKeywords: z
    .array(z.string().trim().min(1).max(80))
    .max(30)
    .optional(),
  /** The most one click may cost, in the ad budget's currency, from get_market_keywords. */
  maxCpc: z.number().positive().max(1_000).optional(),
  finalUrl: z.url({ protocol: /^https?$/ }).max(2048),
  /** The display path after the domain ("example.com/teams/trial"). */
  path1: z.string().trim().min(1).max(15).optional(),
  path2: z.string().trim().min(1).max(15).optional(),
  /** Where it runs: a country or city as Google names it; none is everywhere. */
  location: z.string().trim().min(1).max(80).optional(),
  /** The audience's language, ISO 639-1 ("de"). */
  language: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2}$/)
    .optional(),
  callouts: z
    .array(z.string().trim().min(1).max(25))
    .max(10)
    .refine(uniqueIgnoringCase, "Callouts must differ")
    .optional(),
});
export type CmoSearchAd = z.infer<typeof cmoSearchAdSchema>;

/** The funnel's four stages, top to bottom: the classic AIDA funnel. */
export const CMO_AIDA_STAGES = [
  "awareness",
  "interest",
  "desire",
  "action",
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
  /**
   * Why its post did not go out at its time, in the owner's words. Set by
   * Core; Cuso never sends it.
   */
  notSent: z.string().trim().min(1).max(300).optional(),
  /**
   * What the piece's picture or video shows, for a format that has one. Core
   * makes it from this, attaches it and makes each carousel slide.
   */
  visual: longText.optional(),
  /**
   * Brand pictures (brandPictures fileIds) the visual is made from. A styled
   * picture shows them inside its style, so it names one only when it must
   * show that page, screen or product.
   */
  visualFileIds: z.array(z.string().max(100)).max(3).optional(),
  /**
   * A reference library image (find_style_references) whose look the
   * picture borrows: an old ad, poster or label. Core makes it in that style
   * with the brand's logo, colours and DESIGN.md.
   */
  styleReferenceId: z.string().uuid().optional(),
  /**
   * The kind of picture a styled picture is drawn as (cmo-v11): it borrows
   * only its reference's layout and draws it in the brand's look, so the kind
   * is what keeps a month's pictures varied.
   */
  pictureKind: z.enum(PICTURE_KINDS).optional(),
  /**
   * The few words lettered into a styled picture, spelled exactly; left out,
   * the picture carries no words.
   */
  headline: z.string().trim().min(1).max(60).optional(),
  /** A carousel's slides in order: what each one shows and its few words. */
  slides: z.array(shortText).max(10).optional(),
  /**
   * A styled carousel's words: one entry per slide, in order, lettered into
   * that slide and spelled exactly.
   */
  slideHeadlines: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  /**
   * A talking video's spoken words, hook first, in the brand's own voice.
   * Never a customer's account. The post's draft is its caption.
   */
  script: z.string().trim().min(20).max(600).optional(),
  /** Who speaks it: a stock presenter id, or "owner" for the owner's photo. */
  presenter: z.string().trim().min(1).max(40).optional(),
  /** The stock voice that speaks it. */
  voice: z.string().trim().min(1).max(40).optional(),
  /**
   * A short video's kind (cmo-v20): Core cuts it from the brand's pictures
   * and website to its script. Left out, a short animates its picture.
   */
  shortFormat: z.enum(SHORT_VIDEO_FORMATS).optional(),
  /** A short video's words on screen over its first seconds. */
  hookLine: z.string().trim().min(1).max(48).optional(),
  /** ISO 639-1 language of the script, e.g. "de". */
  languageCode: z.string().trim().length(2).optional(),
  /**
   * The other networks a talking video also goes out on. Core makes the
   * video once and keeps one Social post per network, each with its own
   * caption.
   */
  alsoOn: z
    .array(z.string().trim().toLowerCase().min(1).max(40))
    .max(4)
    .optional(),
  /**
   * On a talking video's post for another network: the entry whose video it
   * shows. Set by Core; Cuso never sends it.
   */
  videoOf: z.string().max(64).optional(),
  /**
   * On a post in another shape (cmo-video-shapes): true when the video it
   * shows is a talking video, false when it is a short or an animated
   * picture. Set by Core; Cuso never sends it.
   */
  videoOfTalking: z.boolean().optional(),
  /**
   * The one real moment the piece is built on, from the Brand Brain: a
   * customer and what they did, a launch, a number, a decision.
   */
  story: shortText.optional(),
  /**
   * The one point the piece argues, in a sentence (cmo-v8). Core compares
   * the month's claims by meaning, so no point is made again in other words.
   */
  claim: shortText.optional(),
  imageFileId: z.string().max(100).optional(),
  /** A carousel's slides in order, the cover first (also its imageFileId). */
  slideFileIds: z.array(z.string().max(100)).max(10).optional(),
  /**
   * The Project file a piece that is not a Social post was written to (an
   * article, a page fix, ad copy, a newsletter). Set by Core when its draft
   * is saved; Cuso never sends it.
   */
  fileId: z.string().max(100).optional(),
  /** A google_ads search piece's parts, so the owner can launch it. */
  searchAd: cmoSearchAdSchema.optional(),
  /**
   * The Google Ads campaign the owner launched from searchAd. Set by Core;
   * Cuso never sends it.
   */
  adCampaign: z
    .object({ accountId: z.string().uuid(), campaignId: z.string().max(64) })
    .optional(),
  taskId: z.string().max(100).optional(),
  /** The campaign this piece belongs to, by campaign id. */
  campaignId: z.string().trim().min(1).max(64).optional(),
  /** The content approach this piece takes, one of the plan's mix. */
  approach: z.enum(CMO_CONTENT_APPROACHES).optional(),
  /** The topic (pillar) it covers. */
  pillar: shortText.optional(),
  /** The funnel step it serves (cmo-v20): every network carries every step. */
  stage: z.enum(CMO_AIDA_STAGES).optional(),
});
export type CmoCalendarEntry = z.infer<typeof cmoCalendarEntrySchema>;

/**
 * What the plan intends with a Social post made from its calendar (ADR
 * 0062): the entry's id and its planning fields. The post itself holds the
 * words, media, network and time.
 */
export const socialPostPlanningSchema = cmoCalendarEntrySchema
  .pick({
    id: true,
    title: true,
    format: true,
    hook: true,
    brief: true,
    why: true,
    approach: true,
    pillar: true,
    stage: true,
    campaignId: true,
    visual: true,
    visualFileIds: true,
    styleReferenceId: true,
    pictureKind: true,
    headline: true,
    slides: true,
    slideHeadlines: true,
    script: true,
    presenter: true,
    voice: true,
    shortFormat: true,
    hookLine: true,
    languageCode: true,
    alsoOn: true,
    videoOf: true,
    videoOfTalking: true,
    story: true,
    claim: true,
  })
  .extend({
    /** The owner's change op that last wrote it (design v5): recovery finds it by this. */
    applyOpId: z.string().optional(),
    /** The owner's change op that made it; later writes keep it, so a replayed create finds it. */
    applyCreateOpId: z.string().optional(),
  });
export type SocialPostPlanning = z.infer<typeof socialPostPlanningSchema>;

/** The kinds of print in the reference library. */
export const REFERENCE_KINDS = [
  "ad",
  "poster",
  "magazine-cover",
  "label",
  "trade-card",
  "playbill",
  "record-cover",
  "book-cover",
  "illustration",
  "infographic",
  "other",
] as const;

/** What a reference suits as a piece's style: Cuso searches by these. */
export const REFERENCE_PURPOSES = [
  "product",
  "announcement",
  "event",
  "offer",
  "how-to",
  "data",
  "comparison",
  "quote",
  "people",
  "story",
  "brand",
] as const;

/**
 * Every stage a saved funnel may hold: AIDA's four, and the three a Cuso
 * before cmo-v5 wrote, which older strategies still carry.
 */
export const CMO_FUNNEL_STAGES = [
  ...CMO_AIDA_STAGES,
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
      /** Set by Core: the owner asked for this lower pace. */
      setByOwner: z.boolean().optional(),
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
      /**
       * What Cuso would start with if the owner says yes to ads (cmo-v5):
       * ads are planned only after that yes.
       */
      suggest: z
        .object({
          channel: channelKey,
          monthly: z.number().min(0).max(10_000_000),
        })
        .optional(),
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
        /** What the page does today, as Cuso saw it. */
        now: shortText.optional(),
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
        /** A name of Cuso's own for the stage; only older strategies have one. */
        name: shortText.optional(),
        goal: shortText,
        /** What Cuso does at this stage, in one plain sentence. */
        cusoDoes: shortText.optional(),
        /** What the owner does at this stage, when it needs them. */
        youDo: shortText.optional(),
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
   * Live social networks this strategy leaves out because they clearly do
   * not fit the buyer, each with its reason. Every other live network is in
   * `channels` (cmo-v5).
   */
  leftOut: z
    .array(z.object({ channel: channelKey, why: shortText }))
    .max(6)
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
      /** Where sales are counted: "Shopify", or "Google Analytics key events". */
      sourceOfTruth: shortText.optional(),
      /** The month's one test: the change, what it should move, when it is judged. */
      experiment: z
        .object({ change: shortText, expect: shortText, judge: shortText })
        .optional(),
    })
    .optional(),
  /** Older plans: assumptions as open questions. New plans ask `questions`. */
  openQuestions: z.array(shortText).max(5).default([]),
  /** Yes/no checks of the plan's biggest assumptions, asked after the plan. */
  questions: z.array(cmoPlanQuestionSchema).max(5).default([]),
};

/**
 * Older plans named their pillars without shares: each gets an equal part.
 */
function sharedPillars(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const named = value.filter((item) => typeof item === "string").length;
  return value.map((item) =>
    typeof item === "string"
      ? { name: item, share: Math.max(5, Math.round(100 / named)) }
      : item,
  );
}

/**
 * The content pillars: three to five recurring topics, each with the share
 * of the month's pieces it gets. Every calendar entry names one.
 */
export const cmoPillarsSchema = z.preprocess(
  sharedPillars,
  z
    .array(
      z.object({
        name: shortText,
        share: z.number().int().min(5).max(100),
        /** What these pieces do for this business, in one plain line. */
        why: shortText.optional(),
      }),
    )
    .max(6),
);
export type CmoPillar = z.infer<typeof cmoPillarsSchema>[number];

/** A sample piece in the strategy proposal, so the owner sees the voice. */
export const cmoPreviewSchema = z.object({
  kind: z.enum(["post", "ad", "seo", "newsletter"]),
  channel: z.string().trim().toLowerCase().min(1).max(40),
  title: shortText,
  body: longText,
});

/**
 * Where Core's calendar for a cmo-v22 month stands: examples before payment,
 * writing while Core writes it, written once it holds the plan's month,
 * stopped when every try for the plan's level ended short.
 */
export const CMO_MONTH_WRITER_STATES = [
  "examples",
  "writing",
  "written",
  "stopped",
] as const;

export const cmoMonthWriterSchema = z.object({
  state: z.enum(CMO_MONTH_WRITER_STATES),
  /** The plan level the calendar was last written for. */
  level: z.enum(CMO_VOLUME_LEVELS).optional(),
  /** The month's first day, fixed by the first write, so a refill keeps its days. */
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Writes started for this approval; a failed one is retried. */
  attempts: z.number().int().min(0).max(1000).default(0),
  /** When the last write started (ISO), so a stale one is retried. */
  startedAt: z.string().max(40).optional(),
  /** When the last write ended (ISO), whole or short. */
  endedAt: z.string().max(40).optional(),
  /** Why the last write stopped short, for Core's logs; never shown. */
  error: z.string().max(300).optional(),
  /** What every write of this month cost on the model, in US dollars. */
  costUsd: z.number().min(0).optional(),
  /** When Core raised that the made month fell short of the plan's floor. */
  floorAlertAt: z.string().max(40).optional(),
});
export type CmoMonthWriter = z.infer<typeof cmoMonthWriterSchema>;

/**
 * Where an owner's change to the running month stands (cmo-v25): applying
 * its post changes, applied (this version approved), being undone, undone,
 * or left as a proposal because the month changed meanwhile.
 */
export const CMO_APPLY_STATES = [
  "applying",
  "applied",
  "undoing",
  "undone",
  "left",
] as const;
export const CMO_APPLY_OP_KINDS = [
  "move",
  "update",
  "cancel",
  "create",
  "swap",
] as const;
/** intent: written before Social is called; done/refused: after. */
export const CMO_APPLY_OP_STATES = ["intent", "done", "refused"] as const;

/** A post as it was before an op, so undo can restore it. */
const cmoApplyPostStateSchema = z.object({
  status: z.string().max(40),
  scheduledAt: z.string().max(40).nullable(),
  text: z.string().max(10_000),
  /** The post's planning as JSON text, so the plan stays plain JSON. */
  planning: z.string().max(20_000).nullable(),
  socialConnectionId: z.string().max(64).nullable(),
  revision: z.number().int(),
});

/** One post change of an owner's change, durable before and after it runs. */
export const cmoApplyOpSchema = z.object({
  /** Durable id, written before Social is called; a created post carries it. */
  opId: z.string().max(64),
  entryId: z.string().max(64),
  kind: z.enum(CMO_APPLY_OP_KINDS),
  /** The existing post it changes (null for a create). */
  postId: z.string().max(64).nullable(),
  prior: cmoApplyPostStateSchema.nullable(),
  state: z.enum(CMO_APPLY_OP_STATES),
  reason: z.string().max(400).optional(),
  after: z
    .object({
      /** The changed post's revision, which undo must still find. */
      revision: z.number().int().nullable(),
      /** The post a create or swap made. */
      postId: z.string().max(64).nullable(),
    })
    .optional(),
});
export type CmoApplyOp = z.infer<typeof cmoApplyOpSchema>;

export const cmoApplyLogSchema = z.object({
  baseVersionId: z.string().max(64),
  baseUpdatedAt: z.string().max(40),
  state: z.enum(CMO_APPLY_STATES),
  startedAt: z.string().max(40),
  /** Refreshed on every write: a live apply keeps it recent, a crashed one doesn't. */
  updatedAt: z.string().max(40),
  endedAt: z.string().max(40).optional(),
  ops: z.array(cmoApplyOpSchema).max(2_000).default([]),
});
export type CmoApplyLog = z.infer<typeof cmoApplyLogSchema>;

/** Whether Core writes this strategy's calendar after payment (cmo-v22). */
export function cmoCalendarAfterPayment(
  plan: { monthWriter?: unknown } | null | undefined,
): boolean {
  return plan?.monthWriter != null;
}

export const marketingStrategyPlanSchema = z.object({
  /** The month the plan covers, YYYY-MM. */
  month: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM"),
  summary: longText,
  /** Why this plan, for this business: audience, goal, competitors. */
  why: longText.optional(),
  goals: z.array(shortText).min(1).max(6),
  audience: shortText.optional(),
  /** The language every piece is in, its calendar title and brief included, named in English ("German"). */
  contentLanguage: shortText.optional(),
  positioning: longText.optional(),
  pillars: cmoPillarsSchema,
  channels: z
    .array(
      z.object({
        channel: channelKey,
        cadence: shortText,
        /** Why this channel at this cadence, for this audience. */
        why: shortText.optional(),
        /**
         * A social network's place in the plan (cmo-v3): main where the main
         * buyer and most of the audience are, at the pace's full rate; side
         * for another buyer, two to three a week.
         */
        role: z.enum(["main", "side"]).optional(),
        /** The Brand Brain buyer a side channel's pieces are written for. */
        buyer: shortText.optional(),
        /** Set by Core: the owner asked for this lower cadence. */
        setByOwner: z.boolean().optional(),
      }),
    )
    .max(10),
  ...strategyPlanShape,
  calendar: z.array(cmoCalendarEntrySchema),
  /** Up to one sample each of a post, an ad, an SEO piece, a newsletter. */
  previews: z.array(cmoPreviewSchema).max(4).default([]),
  /** After a change request: what is different from the last version. */
  changes: z.array(shortText).max(10).default([]),
  /**
   * Set by Core when Cuso's finish turns could not fill the month and the
   * strategy was fitted to its calendar: each cadence it lowered, in words
   * the owner reads. The next whole save clears it.
   */
  fitted: z.array(shortText).max(12).optional(),
  /**
   * cmo-v22: Core writes the month's calendar after payment, sized to the
   * plan bought; until then the calendar holds the strategy's example posts.
   * Present on every strategy of that shape, whatever its state, so a full
   * calendar written before (every strategy before cmo-v22) never has it.
   * Set by Core; Cuso never sends it.
   */
  monthWriter: cmoMonthWriterSchema.optional(),
  /**
   * cmo-v25: an owner's change applied to the running month, op by op, so
   * a crash is resumed or undone and Go back undoes exactly it. Set by Core;
   * Cuso never sends it.
   */
  applyLog: cmoApplyLogSchema.optional(),
  /**
   * What the last patch changed: each entry it touched, with the entry as it
   * was before (null when the patch added it), so CMO can strike it through.
   * Set by Core; the next whole save clears it.
   */
  patched: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        was: cmoCalendarEntrySchema.nullable(),
      }),
    )
    // Every entry a turn's patches touched or added.
    .default([]),
});
export type MarketingStrategyPlan = z.infer<typeof marketingStrategyPlanSchema>;
