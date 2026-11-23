import {
  CMO_SEO_PLAIN_SKILL,
  CMO_SEO_REPORTS_SKILL,
} from "./cmo-v12-skills.js";
import { cmoV15 } from "./cmo-v15.js";
import { CMO_PLAIN_WORDS_STRATEGY_SKILL } from "./cmo-v15-skills.js";
import {
  CMO_MONTH_POINTS_SKILL,
  CMO_SITE_PAGES_SKILL,
  CMO_V20_STRATEGY_SKILL,
} from "./cmo-v20-skills.js";
import type { SokoBotVersion } from "./types.js";

const SKILL_SWAPS: Readonly<Record<string, string>> = {
  [CMO_PLAIN_WORDS_STRATEGY_SKILL]: CMO_V20_STRATEGY_SKILL,
  [CMO_SEO_REPORTS_SKILL]: CMO_SEO_PLAIN_SKILL,
};

/**
 * cmo-v15 with the week of 2026-11-23 folded into one version (owner): every
 * funnel step on every network, each piece its own point and the offer
 * pieces marked, pillars built on Brand Brain facts, short videos cut from a
 * script, the whole site page by page, LinkedIn on one specific story and
 * the SEO report in plain words.
 */
export const cmoV20: SokoBotVersion = {
  ...cmoV15,
  id: "cmo-v20",
  name: "cmo-v20 · Cuso, one point a post on every step",
  createdAt: "2026-11-23",
  summary:
    "Cuso on cmo-v15 whose month says more than one thing: every network helps at every step from finding the business to buying, every post argues its own point, the offer goes out with its link twice a week, pillars rest on real facts, short videos are cut from a script, he works from every page of the site, and LinkedIn posts tell one specific story.",
  whatsNew: [
    "Each post now makes its own point, and your offer goes out with its link twice a week.",
    "Your strategy shows how much of your month serves each step, from finding you to buying.",
    "Your TikToks, Reels and Shorts now have a voice, captions and music.",
    "Cuso now reads every page of your site and uses its facts and prices.",
  ],
  releaseNote:
    "Each post of your month now makes its own point, your offer goes out with its link twice a week, every network helps at every step from finding you to buying, your short videos have a voice, captions and music, and I work from every page of your site.",
  skills: [
    ...cmoV15.skills.map((skill) => SKILL_SWAPS[skill] ?? skill),
    CMO_MONTH_POINTS_SKILL,
    CMO_SITE_PAGES_SKILL,
  ],
};
