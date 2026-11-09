import brandBrains from "./fixtures/cmo-brand-brains.json";
import brands from "./fixtures/cmo-brands.json";

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
];
