import { cmoV15 } from "./cmo-v15.js";
import { CMO_PLAIN_WORDS_STRATEGY_SKILL } from "./cmo-v15-skills.js";
import {
  CMO_MONTH_POINTS_SKILL,
  CMO_PILLAR_FACTS_STRATEGY_SKILL,
} from "./cmo-v17-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v15 whose month says more than one thing (owner, 2026-11-23): Core
 * gives every piece its own point before the writer runs and marks the offer
 * pieces the funnel promises, each chunk reads only its network's writing
 * skill, LinkedIn posts are built on one specific story, number or
 * decision, and every pillar rests on at least three Brand Brain facts. cmo-v16 (short videos) is another agent's; this builds on
 * cmo-v15 until that one lands.
 */
export const cmoV17: SokoBotVersion = {
  ...cmoV15,
  id: "cmo-v17",
  name: "cmo-v17 · Cuso, one point a post",
  createdAt: "2026-11-23",
  summary:
    "Cuso on cmo-v15 whose month says more than one thing: every post argues its own point, the offer goes out with its link twice a week where the plan says, and LinkedIn posts tell one specific story, number or decision.",
  whatsNew: [
    "Each post now makes its own point, so your month repeats itself less.",
    "Your offer goes out with its link twice a week, as your plan promises.",
    "LinkedIn posts now tell one real story or number from your business.",
    "Your strategy's topics now come from what your buyers get, each backed by real facts.",
  ],
  releaseNote:
    "Each post of your month now makes its own point, your offer goes out with its link twice a week as the plan says, and my LinkedIn posts tell one real story or number from your business.",
  skills: [
    ...cmoV15.skills.map((skill) =>
      skill === CMO_PLAIN_WORDS_STRATEGY_SKILL
        ? CMO_PILLAR_FACTS_STRATEGY_SKILL
        : skill,
    ),
    CMO_MONTH_POINTS_SKILL,
  ],
};
