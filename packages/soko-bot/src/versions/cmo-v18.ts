import { cmoV15 } from "./cmo-v15.js";
import { CMO_PLAIN_WORDS_STRATEGY_SKILL } from "./cmo-v15-skills.js";
import { CMO_STAGE_SPREAD_STRATEGY_SKILL } from "./cmo-v18-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v15 whose funnel is steps, not networks (owner, 2026-11-23): every
 * network carries every step, each calendar entry names the step it serves,
 * and the strategy screen shows each step's share of the month. cmo-v16
 * (short videos) and cmo-v17 (one point a post) are other agents'; this
 * builds on cmo-v15 and folds into whichever of them ships first.
 */
export const cmoV18: SokoBotVersion = {
  ...cmoV15,
  id: "cmo-v18",
  name: "cmo-v18 · Cuso, every step on every network",
  createdAt: "2026-11-23",
  summary:
    "Cuso on cmo-v15 whose strategy is four plain steps: every network helps people find, look at, want and take the offer, and the strategy shows how much of the month serves each step.",
  whatsNew: [
    "Your strategy now shows how much of your month serves each step, from finding you to buying.",
    "Every network now helps at every step, instead of one step each.",
  ],
  releaseNote:
    "Your strategy now shows the four steps from finding you to buying, and how much of your month serves each one. Every network helps at every step.",
  skills: cmoV15.skills.map((skill) =>
    skill === CMO_PLAIN_WORDS_STRATEGY_SKILL
      ? CMO_STAGE_SPREAD_STRATEGY_SKILL
      : skill,
  ),
};
