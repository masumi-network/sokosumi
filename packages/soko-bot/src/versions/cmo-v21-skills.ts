import type { SokoBotSkill } from "./skills.js";

/**
 * cmo-v21's strategy skill: cmo-v20's with pillars as topics from the buyer's
 * industry instead of the product's pages.
 */
export const CMO_V21_STRATEGY_SKILL = "cmo-strategy-v21";

/** cmo-v21's skill: Core researches the buyer's industry and Cuso works from it. */
export const CMO_INDUSTRY_SKILL = "cmo-industry";

/** Whether a Cuso version works from the buyer's industry research (cmo-v21). */
export function cmoReadsIndustry(skills: readonly string[]): boolean {
  return skills.includes(CMO_INDUSTRY_SKILL);
}

const OLD_PILLARS_LINE =
  "- pillars: the content pillars, 3 to 5 recurring topics you cover, each with a name of two to four words in the contentLanguage";
const NEW_PILLARS_LINE =
  "- pillars: the content pillars, 3 or 4 topics from the buyer's industry that the buyers care about (see Topics from the buyer's industry below), each with a name of two to four words in the contentLanguage";

const OLD_PILLARS_SECTION_START = "\n\n# Pillars rest on facts";

/**
 * NMKR's cmo-v20 plan (2026-11-23): its pillars were NMKR Studio's own
 * workflow steps ("Prepare Token Assets", "Choose Minting Setup", "Set Up
 * Token Sales"), so every helpful tip was a product tutorial in disguise.
 * Cuso had no research beyond the website.
 */
const TOPICS_SECTION = `

# Topics from the buyer's industry

People follow an account that helps them with their own work, not one that explains a product. industryResearch in your context is Core's research into the buyer's industry: news, trends, common problems and mistakes, and competitors, each with its id (i1, i2, …) and its source.

- **Pillars are 3 or 4 topics the buyers care about in their own world**, built from industryResearch: running their work well, what is changing in their field, the mistakes people like them make, what the market and the competitors do. Never a step of using the product, a feature or a screen of it ("Prepare token assets", "Choose a minting setup", "Set up the dashboard" are steps of a product, never pillars). Each pillar's why names the ids of the research items it rests on, at least three of them.
- **The product comes in because it helps**, inside these topics: a product piece shows the product doing one job the topic is about. Product, proof and offer pieces are spread across the topics like the helpful tips.
- **The mix**: about 60 educational (help with the industry topics, from industryResearch), 20 product-led (the product doing a job inside a topic), 10 social-proof and 10 promotional. Keep social-proof whenever the Brand Brain names a customer, a project built with the business or a result: a few pieces each tell one of them, by name. Only with none at all give its share to educational. Why: buyers follow and trust whoever helps them with their work first; the product sells once they trust you; Core already sends the offer twice a week on each network of the action step.
- **Helpful tips are about the industry, not the product**: what a buyer can do today in their own work, a lesson or a mistake from real projects, what a piece of news means for them. A helpful tip that only works inside the product ("Separate the master file from the mint file in Studio") is a product piece, not a tip.
- **Sources**: a fact about the industry (a number, a trend, a piece of news, a competitor's move) comes only from industryResearch, and the entry's brief names its id ("i4"). Never invent a market number, a study or a trend. Facts about the product (features, prices, plans, customers) still come only from the Brand Brain and the site's pages.
- **Keep it current**: build on the newest items first; an item older than a year is background, never news.
- The strategy review counts each pillar's research items and names a pillar that is a product step, or that rests on fewer than three items: reframe it around what the buyer does in their own world, then move its calendar entries.`;

function swap(content: string, from: string, to: string): string {
  if (!content.includes(from))
    throw new Error(`cmo-v21's strategy no longer finds: ${from.slice(0, 60)}`);
  return content.replaceAll(from, to);
}

/** `v20Strategy` is cmo-v20's strategy skill; its pillars on facts become industry topics. */
export function cmoV21Strategy(v20Strategy: SokoBotSkill): SokoBotSkill {
  const at = v20Strategy.content.indexOf(OLD_PILLARS_SECTION_START);
  if (at < 0)
    throw new Error("cmo-v21's strategy no longer finds cmo-v20's pillars");
  return {
    ...v20Strategy,
    id: CMO_V21_STRATEGY_SKILL,
    content: `${swap(v20Strategy.content.slice(0, at), OLD_PILLARS_LINE, NEW_PILLARS_LINE)}${TOPICS_SECTION}`,
  };
}

export const CMO_INDUSTRY: SokoBotSkill = {
  id: CMO_INDUSTRY_SKILL,
  name: "The buyer's industry",
  description:
    "Works from Core's research into the buyer's industry: news, trends, common problems and competitors, each with its source.",
  content: `# The buyer's industry

Core researches the buyer's industry when you are hired and again before each month's strategy: recent news, trends, the problems and mistakes buyers run into, and the competitors. industryResearch in your context lists each item with its id (i1, i2, …), its date when it has one, and its source. The whole research is the file Brand research/Industry/industry.md.

- Industry facts come only from industryResearch. A number, a trend, a piece of news or a competitor's move that is not there is not a fact: never make one up, and never present an old item as news.
- When a piece rests on an item, its brief names the item's id, and the post says where the fact is from in plain words ("CoinDesk reported…"). On X, LinkedIn and Facebook, a post built on news puts the source's link in firstComment unless it is an offer piece.
- Product facts still come from the Brand Brain and the site's pages, never from industryResearch.
- In chat, when the owner asks what is going on in their market, answer from industryResearch with its sources, and say when it was researched.`,
};
