import type { SokoBotScenario } from "@sokosumi/soko-bot";
import brandBrains from "./fixtures/cmo-brand-brains.json";
import brands from "./fixtures/cmo-brands.json";
import monthPlans from "./fixtures/cmo-month-plans.json";
import examplePlans from "./fixtures/cmo-v22-plans.json";

export interface CmoEvalBrand {
  name: string;
  url: string;
  goal: string;
  /** What the brand sells, as a pattern the plan's headline parts must match. */
  main: string;
  /** What the Brand Brain must name, when it differs from the plan (a launch). */
  brain?: string;
  /** A side product the plan must not be about. */
  avoid?: string;
  /** The language its posts must be written in. */
  contentLanguage?: string;
  siteLanguage?: string;
  /** Words the plan's summary uses when it must not be in English. */
  planLanguage?: string;
  /** Words its calendar titles use when they are in the posts' language. */
  pieceLanguage?: string;
  /** A business with many product lines lists at least this many offers. */
  minOffers?: number;
  /** The main offer's price as its site publishes it. */
  price?: string;
  /** A social profile the site links to that the Brand Brain must list. */
  profile?: string;
  why?: string;
  /** Research found a website and no profile on any network. */
  websiteOnly?: boolean;
  /** One promise the case checks on its own (cmo-v5's three, cmo-v8's claims). */
  focus?: "top-volume" | "funnel-plan" | "video-networks" | "claims";
  /** The Cuso works on Tester credits, with no plan bought. */
  testerCredits?: boolean;
}

/** Real brands with what each sells: the CMO lab and the CMO eval cases share them. */
export const CMO_EVAL_BRANDS: readonly CmoEvalBrand[] = brands;

export type CmoEvalCase =
  | {
      /** Cuso learns the brand from its live website into a Brand Brain. */
      kind: "cmo-research";
      brand: CmoEvalBrand;
    }
  | {
      /** Cuso plans the month from a frozen Brand Brain. */
      kind: "cmo-strategy";
      brand: CmoEvalBrand;
      brandBrain: unknown;
    }
  | {
      /**
       * Cuso and Core make an approved plan's pieces, and Jev reviews them:
       * a short frozen plan, its dates moved to start tomorrow.
       */
      kind: "cmo-month";
      brand: CmoEvalBrand;
      brandBrain: unknown;
      plan: unknown;
      /**
       * A month of pictures alone, one of them of the brand's own homepage:
       * the lane gets the homepage's screenshot as a brand picture first.
       */
      pictures?: true;
      /** A month with a newsletter issue: scored on the issue Core files. */
      newsletter?: true;
      /**
       * cal.com's 28-piece month (the change request's), timed: how long
       * until every word is written and how many tokens production read.
       */
      timed?: true;
      /** A one-pillar how-to month: scored on the kinds of print its pictures take. */
      variety?: true;
      /** A LinkedIn month: scored on Jev's read of each post's first two lines. */
      openings?: true;
      /**
       * cmo-v22: the plan is the strategy with its example posts, and the
       * case is Core's calendar written after payment at this plan level.
       */
      writes?: "steady" | "active" | "all_in";
    };

/**
 * Research reads the live site, so these are brands whose site is stable and
 * whose trap is in what Cuso writes down: a German site, many product lines,
 * a feature that shares the goal's word.
 */
const RESEARCH_BRANDS = [
  "cal.com",
  "Hiltl",
  "FREITAG",
  "Apple",
  "Blue Bottle Coffee",
  "utxo.ag",
  "Begin",
  "entry.fyi",
];

/**
 * Planning starts from the Brand Brain Cuso wrote for the brand once
 * (`fixtures/cmo-brand-brains.json`), so a change to the strategy prompt is
 * measured on the same input every day.
 */
const STRATEGY_BRANDS = [
  "utxo.ag",
  "cal.com",
  "Mailchimp",
  "HubSpot",
  "lemlist",
  "Blue Bottle Coffee",
  "Hiltl",
  "FREITAG",
  "plausible.io",
  "tldraw.com",
  "nmkr.io",
  "entry.fyi",
];

function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function brand(name: string): CmoEvalBrand {
  const found = CMO_EVAL_BRANDS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No CMO eval brand ${name}`);
  return found;
}

const frozenBrains = brandBrains as Record<string, unknown>;

/** The brand whose Brand Brain the website-only case strips of its profiles. */
const WEBSITE_ONLY_BRAND = "utxo.ag";

/**
 * A Brand Brain as research leaves it for a business with a website and no
 * profile anywhere: only the site in its channels, nothing posted today.
 */
export function websiteOnlyBrain(brain: unknown): unknown {
  const whole = brain as {
    channels?: { name: string }[];
    marketingToday?: Record<string, unknown>;
  };
  return {
    ...whole,
    channels: (whole.channels ?? []).filter(
      (channel) => channel.name === "Website",
    ),
    marketingToday: {
      ...whole.marketingToday,
      summary:
        "No social profiles were found: the business markets through its website only. Paid advertising activity is unknown.",
      channels: [],
    },
  };
}
const frozenPlans = monthPlans as Record<string, unknown>;

/**
 * cmo-v22 strategies as Cuso saved them (the plan and its example posts),
 * each the input of Core's month writer at every plan level.
 */
const frozenExamplePlans = examplePlans as Record<string, unknown>;
const WRITER_LEVELS = [
  { level: "steady", plan: "Starter" },
  { level: "active", plan: "Growth" },
  { level: "all_in", plan: "Scale" },
] as const;

/**
 * cmo-v5's promises NMKR's month of 2026-11-19 broke, each a case on a
 * company-buyer brand: 20 posts on Tester credits, a funnel promising what
 * the plan did not hold, YouTube left out as quiet and TikTok as too young.
 */
const CMO_V5_FOCUS_CASES = [
  {
    id: "cmo-strategy-tester-top-volume",
    brand: "utxo.ag",
    title: "Writes the whole month on Tester credits",
    intent:
      "A Cuso on Tester credits with no plan bought writes the month at the top volume, all_in on every network, and Core makes all of it.",
    focus: "top-volume" as const,
    testerCredits: true,
  },
  {
    id: "cmo-strategy-funnel-matches-plan",
    brand: "plausible.io",
    title: "Writes a funnel in the plan's own numbers",
    intent:
      "Every channel, cadence and video the funnel names is in the plan's channels and calendar, and every planned network is in the funnel.",
    focus: "funnel-plan" as const,
  },
  {
    id: "cmo-strategy-video-networks-b2b",
    brand: "HubSpot",
    title: "Plans YouTube and TikTok for a company buyer",
    intent:
      "A brand that sells to companies still gets YouTube and TikTok, fed by the month's talking videos, and no network is left out for a quiet account.",
    focus: "video-networks" as const,
  },
];

/**
 * Making a month takes a production run, Core's pictures and Jev's review,
 * so a few brands with different channels and a non-English one.
 */
const MONTH_BRANDS = ["cal.com", "Hiltl", "Blue Bottle Coffee"];

/**
 * Two single pictures and a carousel on cal.com's frozen month. The second
 * must show the real homepage, so its screenshot has to sit inside the style.
 */
const PICTURE_PIECES = [
  {
    id: "cal-pictures-trial",
    time: "09:00",
    title: "Fourteen days to try team booking",
    format: "image",
    brief:
      "Announce the 14-day Teams trial with one bold picture that stops a revenue leader mid-scroll.",
    approach: "promotional",
    pillar: "Team booking",
  },
  {
    id: "cal-pictures-homepage",
    time: "10:00",
    title: "This is where a team booking starts",
    format: "image",
    brief:
      "Show Cal.com's real homepage as a visitor sees it and say that every team booking flow starts there. The picture must show the actual page, not a drawing of one.",
    approach: "product-led",
    pillar: "Setup and control",
  },
  {
    id: "cal-pictures-routing",
    time: "11:00",
    title: "How a lead reaches the right rep",
    format: "images",
    brief:
      "Two slides: a lead picks a time on the booking page; routing hands the meeting to the right sales rep.",
    approach: "educational",
    pillar: "Lead routing",
  },
].map((piece) => ({
  ...piece,
  date: "2026-11-10",
  channel: "linkedin",
  status: "idea",
  campaignId: "team-routing-trial",
}));

/**
 * NMKR's month (2026-11-20) was how-to from end to end, on one pillar, and
 * 56 of its 69 pictures took an infographic. Eight how-to pictures on three
 * networks, one pillar: the kinds must still vary.
 */
const VARIETY_PIECES = [
  ["x", "09:00", "Mint a token in three steps"],
  ["linkedin", "10:00", "Set royalties before the first sale"],
  ["instagram", "11:00", "Upload art and metadata in one go"],
  ["x", "09:00", "Check a policy ID before you buy"],
  ["linkedin", "10:00", "Price a drop without a spreadsheet"],
  ["instagram", "11:00", "Airdrop to a holder list"],
  ["x", "09:00", "Lock a policy so supply is final"],
  ["linkedin", "10:00", "Sell with a payment link in NMKR Studio"],
].map(([channel, time, title], index) => ({
  id: `nmkr-variety-${index + 1}`,
  date: `2026-11-${String(10 + Math.floor(index / 3)).padStart(2, "0")}`,
  time,
  channel,
  title,
  format: "image",
  brief: `A how-to piece: ${title.toLowerCase()} in NMKR Studio, step by step, for a creator launching a first collection.`,
  approach: "educational",
  pillar: "Minting without code",
  status: "idea",
}));

/** NMKR's strategy for the variety month: one pillar, how-to only. */
function nmkrHowToPlan(): unknown {
  const base = frozenPlans["cal.com"] as Record<string, unknown>;
  return {
    ...base,
    summary:
      "Show creators and brands how to mint and sell tokens on Cardano with NMKR Studio, no code.",
    why: "Creators pick a minting tool by how fast a first drop goes live.",
    goals: ["More paid NMKR Studio projects"],
    audience: "Creators and brands launching tokens on Cardano",
    positioning: "The no-code way to mint and sell on Cardano",
    idea: {
      who: "Creators and brands launching tokens on Cardano",
      position: "The no-code way to mint and sell on Cardano",
      attract: "One NMKR Studio task shown start to finish on each network",
      offer: "NMKR Studio",
      sentence:
        "We show creators one NMKR Studio task at a time, start to finish, and invite them to start a project.",
    },
    pillars: [
      {
        name: "Minting without code",
        share: 100,
        why: "What NMKR Studio does",
      },
    ],
    mix: [
      {
        approach: "educational",
        share: 100,
        why: "How-to teaches the product",
      },
    ],
    channels: ["x", "linkedin", "instagram"].map((channel) => ({
      channel,
      cadence: "3 a week",
      why: "Where Cardano creators and brands look for tools.",
    })),
    offer: {
      what: "NMKR Studio",
      why: "Mint and sell without code",
      proof: [],
      action: "Start a project in NMKR Studio",
    },
    campaigns: [],
    funnel: [],
    questions: [],
    beforeAfter: [],
    calendar: VARIETY_PIECES,
  };
}

/**
 * cal.com's LinkedIn posts (2026-11-20) opened on advice and failed Jev's
 * hook rule on 2 of 2 runs: four how-to and product posts, where advice is
 * the easy opening.
 */
const OPENING_PIECES = [
  [
    "09:00",
    "How routing forms pick the right rep",
    "educational",
    "Lead routing",
  ],
  [
    "10:00",
    "Five settings admins change first",
    "educational",
    "Setup and control",
  ],
  ["11:00", "Round-robin without spreadsheets", "product-led", "Team booking"],
  ["12:00", "Reminders that cut no-shows", "educational", "Team booking"],
].map(([time, title, approach, pillar], index) => ({
  id: `cal-openings-${index + 1}`,
  date: "2026-11-10",
  time,
  channel: "linkedin",
  title,
  format: "post",
  brief: `${title}, for revenue teams evaluating Cal.com Teams.`,
  approach,
  pillar,
  status: "idea",
  campaignId: "team-routing-trial",
}));

/** A post and the newsletter issue it points to: the issue is a Files piece. */
const NEWSLETTER_PIECES = [
  {
    id: "cal-newsletter-li",
    time: "09:00",
    channel: "linkedin",
    title: "Routing forms send each lead to the right rep",
    format: "post",
    brief:
      "Show how a routing form asks two questions and books the meeting with the rep who owns that segment.",
    approach: "educational",
    pillar: "Lead routing",
  },
  {
    id: "cal-newsletter-issue",
    time: "10:00",
    channel: "newsletter",
    title: "November: routing that books the right rep",
    format: "issue",
    brief:
      "This month's issue for Cal.com's list: one routing tip, one customer example from the Brand Brain, and the Teams trial as the next step.",
    approach: "educational",
    pillar: "Lead routing",
  },
].map((piece) => ({
  ...piece,
  date: "2026-11-10",
  status: "idea",
  campaignId: "team-routing-trial",
}));

export const CMO_EVAL_CASES = [
  ...RESEARCH_BRANDS.map((name) => ({
    id: `cmo-research-${slug(name)}`,
    suite: "cmo" as const,
    area: "Research",
    title: `Learns ${name}`,
    intent:
      brand(name).why ??
      "The Brand Brain names what the brand sells, from its own website.",
    kind: "cmo-research" as const,
    brand: brand(name),
  })),
  ...STRATEGY_BRANDS.filter((name) => frozenBrains[name]).map((name) => ({
    id: `cmo-strategy-${slug(name)}`,
    suite: "cmo" as const,
    area: "Strategy",
    title: `Plans ${name}'s month`,
    intent:
      brand(name).why ??
      "The strategy sells the main offer, in the owner's language, by the strategy skill's rules.",
    kind: "cmo-strategy" as const,
    brand: brand(name),
    brandBrain: frozenBrains[name],
  })),
  ...(frozenBrains[WEBSITE_ONLY_BRAND]
    ? [
        {
          id: "cmo-strategy-website-only",
          suite: "cmo" as const,
          area: "Strategy",
          title: "Plans every network for a business with only a website",
          intent:
            "A business with no profile anywhere still gets every fitting network planned, each as a new side channel, and none parked in proposals.",
          kind: "cmo-strategy" as const,
          brand: { ...brand(WEBSITE_ONLY_BRAND), websiteOnly: true },
          brandBrain: websiteOnlyBrain(frozenBrains[WEBSITE_ONLY_BRAND]),
        },
      ]
    : []),
  ...(frozenBrains["nmkr.io"]
    ? [
        {
          id: "cmo-strategy-one-pillar-claims",
          suite: "cmo" as const,
          area: "Strategy",
          title: "Gives every piece of a one-pillar month its own point",
          intent:
            "NMKR's month made one point in most posts. On a one-pillar brand every calendar entry argues its own claim, and no point comes back twice in a week or more than three times in the month.",
          kind: "cmo-strategy" as const,
          brand: { ...brand("nmkr.io"), focus: "claims" as const },
          brandBrain: frozenBrains["nmkr.io"],
        },
        {
          id: "cmo-month-picture-variety",
          suite: "cmo" as const,
          area: "Month",
          title: "Varies the pictures of a how-to month",
          intent:
            "A month of how-to pieces on one pillar takes an infographic for at most one picture in four, and neighbouring pictures on a network take different kinds of print.",
          kind: "cmo-month" as const,
          brand: brand("nmkr.io"),
          brandBrain: frozenBrains["nmkr.io"],
          plan: nmkrHowToPlan(),
          variety: true as const,
        },
      ]
    : []),
  ...CMO_V5_FOCUS_CASES.filter(({ brand: name }) => frozenBrains[name]).map(
    ({ id, brand: name, title, intent, ...extra }) => ({
      id,
      suite: "cmo" as const,
      area: "Strategy",
      title,
      intent,
      kind: "cmo-strategy" as const,
      brand: { ...brand(name), ...extra },
      brandBrain: frozenBrains[name],
    }),
  ),
  ...Object.keys(frozenExamplePlans)
    .filter((name) => frozenBrains[name])
    .flatMap((name) =>
      WRITER_LEVELS.map(({ level, plan }) => ({
        id: `cmo-month-calendar-${slug(name)}-${level.replace("_", "-")}`,
        suite: "cmo" as const,
        area: "Month",
        title: `Plans ${name}'s ${plan} month after payment`,
        intent: `Core writes the whole ${plan} month from cmo-v22's plan and examples, in parallel calls: at least the plan's floor, every topic and kind of post at its share on every network, every funnel step, no post repeating another's point across calls, and the examples kept word for word.`,
        kind: "cmo-month" as const,
        brand: brand(name),
        brandBrain: frozenBrains[name],
        plan: frozenExamplePlans[name],
        writes: level,
      })),
    ),
  ...MONTH_BRANDS.filter((name) => frozenBrains[name] && frozenPlans[name]).map(
    (name) => ({
      id: `cmo-month-${slug(name)}`,
      suite: "cmo" as const,
      area: "Month",
      title: `Makes ${name}'s pieces`,
      intent:
        "Every approved piece is written and made, and Jev finds it follows its writing skill and the brand's voice.",
      kind: "cmo-month" as const,
      brand: brand(name),
      brandBrain: frozenBrains[name],
      plan: frozenPlans[name],
    }),
  ),
  ...(frozenBrains["cal.com"] && frozenPlans["cal.com"]
    ? [
        {
          id: "cmo-month-timed",
          suite: "cmo" as const,
          area: "Month",
          title: "Makes a 28-piece month in minutes, on few tokens",
          intent:
            "A whole month of posts, pictures and newsletter issues is written within fifteen minutes of approval, production reads at most 200,000 input tokens a piece, and Jev finds the pieces follow their skills and the brand's voice.",
          kind: "cmo-month" as const,
          brand: brand("cal.com"),
          brandBrain: frozenBrains["cal.com"],
          plan: frozenPlans["cal.com"],
          timed: true as const,
        },
        {
          id: "cmo-month-styled-pictures",
          suite: "cmo" as const,
          area: "Month",
          title: "Styles every picture of cal.com's month",
          intent:
            "Every picture of the month is made in a reference library style, each from its own reference: a carousel's slides with their own words, and the real homepage set inside the style where a piece shows it.",
          kind: "cmo-month" as const,
          brand: brand("cal.com"),
          brandBrain: frozenBrains["cal.com"],
          plan: {
            ...(frozenPlans["cal.com"] as object),
            calendar: PICTURE_PIECES,
          },
          pictures: true as const,
        },
        {
          id: "cmo-month-linkedin-openings",
          suite: "cmo" as const,
          area: "Month",
          title: "Opens cal.com's LinkedIn posts on a result",
          intent:
            "Every LinkedIn post's first two lines carry a result, a number, a named customer or a surprising decision, never advice, so Jev's hook rule holds on all of them.",
          kind: "cmo-month" as const,
          brand: brand("cal.com"),
          brandBrain: frozenBrains["cal.com"],
          plan: {
            ...(frozenPlans["cal.com"] as object),
            calendar: OPENING_PIECES,
          },
          openings: true as const,
        },
        {
          id: "cmo-month-newsletter",
          suite: "cmo" as const,
          area: "Month",
          title: "Writes cal.com's newsletter issue",
          intent:
            "The month's newsletter issue is written in full, with its subject line, short enough to read in a minute, and filed for the owner to send.",
          kind: "cmo-month" as const,
          brand: brand("cal.com"),
          brandBrain: frozenBrains["cal.com"],
          plan: {
            ...(frozenPlans["cal.com"] as { channels: unknown[] }),
            channels: [
              ...((frozenPlans["cal.com"] as { channels: unknown[] })
                .channels ?? []),
              {
                channel: "newsletter",
                cadence: "1 issue a month",
                why: "Keep trial users and customers up to date.",
              },
            ],
            calendar: NEWSLETTER_PIECES,
          },
          newsletter: true as const,
        },
      ]
    : []),
];

/** What a Cuso chat case finds in its lane, whatever case ran there before. */
export type CmoChatSetup =
  | "cmo-brand"
  | "cmo-new-client"
  | "cmo-comments"
  /** cal.com's approved month, three posts out last week, drafts for next month. */
  | "cmo-weekly-review"
  /** An article idea on "calendly alternative" the owner skipped earlier. */
  | "cmo-seo-skipped"
  /** cal.com's Search Console connected, with this and the last 28 days (cmo-v12's SEO cases). */
  | "cmo-seo-report"
  /** cal.com's month waiting for approval, for the change request. */
  | "cmo-plan"
  /** cal.com with a weekly review from last week under three newer daily reports. */
  | "cmo-report"
  /** The same month, after the owner said yes to ads and set a budget. */
  | "cmo-plan-ads"
  /** cal.com's competitors after a check: a week with moves, or a quiet one. */
  | "cmo-competitors"
  | "cmo-competitors-quiet"
  | "cmo-competitors-second-hand"
  | "cmo-competitors-busy"
  /** An approved month with an ad budget and the competitors' searches read. */
  | "cmo-competitor-ads"
  /** The same, after a check that stored what the competitors say of themselves. */
  | "cmo-competitor-landing-page";

/** The brand Cuso's chat and replies cases run for, and the comments it answers. */
export const CMO_CHAT_BRAND = "cal.com";

export const CMO_EVAL_COMMENTS = [
  {
    key: "price",
    author: "Maya Lindqvist",
    text: "How much does Cal cost for a team of five?",
    expect: ["reply", "owner"],
  },
  {
    key: "angry",
    author: "Derek Holm",
    text: "Third time this week my booking link broke and a client couldn't book. Fix it or I'm cancelling.",
    expect: ["owner"],
  },
  {
    key: "spam",
    author: "crypto_signals_247",
    text: "🔥🔥 Want 10x returns? DM me for free crypto signals!!",
    expect: ["skip"],
  },
  {
    key: "praise",
    author: "Priya Raman",
    text: "Switched our whole sales team to Cal last month, booking calls is so much easier now.",
    expect: ["reply"],
  },
  {
    key: "german",
    author: "Jonas Becker",
    text: "Gibt es eine Integration mit Google Meet?",
    expect: ["reply", "owner"],
  },
] as const;

/** Cuso answers the day's comments: replies, skips and hand-overs. */
export const CMO_COMMENT_SCENARIO: SokoBotScenario = {
  id: "cmo-comment-replies",
  title: "Answers the day's comments",
  intent:
    "Replies where a reply helps, in the commenter's language and the brand's voice; hands complaints to the owner and skips spam.",
  prompt:
    "Go through today's comments on our Instagram post and handle each one.",
  rubric:
    "Cuso called list_social_comments and handled every comment with handle_social_comment: the spam is skipped, the angry customer whose booking link broke goes to the owner with a one-line note, the praise gets a short thank-you, the German question gets a German reply (or goes to the owner if the Brand Brain does not say), and the price question gets the price from the Brand Brain or goes to the owner. Replies are under 300 characters, in the brand's voice, and invent no facts, prices or promises. Claiming a reply was posted without a successful handle_social_comment fails.",
  expect: {
    routes: ["MANAGE_WORK", "DIRECT_RESPONSE"],
    tools: ["list_social_comments", "handle_social_comment"],
    forbiddenTools: ["create_social_post", "publish_social_post", "hire_agent"],
  },
};
