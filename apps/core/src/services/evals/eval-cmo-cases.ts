import type { SokoBotScenario } from "@sokosumi/soko-bot";
import brandBrains from "./fixtures/cmo-brand-brains.json";
import brands from "./fixtures/cmo-brands.json";
import monthPlans from "./fixtures/cmo-month-plans.json";

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
  /** Words the plan's summary uses when it must not be in English. */
  planLanguage?: string;
  /** A business with many product lines lists at least this many offers. */
  minOffers?: number;
  /** The main offer's price as its site publishes it. */
  price?: string;
  /** A social profile the site links to that the Brand Brain must list. */
  profile?: string;
  why?: string;
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
const frozenPlans = monthPlans as Record<string, unknown>;

/**
 * Making a month takes a production run, Core's pictures and Jev's review,
 * so a few brands with different channels and a non-English one.
 */
const MONTH_BRANDS = ["cal.com", "Hiltl", "Blue Bottle Coffee"];

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
      "The plan sells the main offer, in the owner's language, by the strategy skill's rules.",
    kind: "cmo-strategy" as const,
    brand: brand(name),
    brandBrain: frozenBrains[name],
  })),
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
];

/** The brand the replies case answers for, and the comments it answers. */
export const CMO_COMMENT_BRAND = "cal.com";

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
