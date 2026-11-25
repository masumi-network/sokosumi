import { cmoV21 } from "./cmo-v21.js";
import { CMO_V21_STRATEGY_SKILL } from "./cmo-v21-skills.js";
import { CMO_V22_STRATEGY_SKILL } from "./cmo-v22-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v21 whose strategy shows the plan and a few example posts (owner,
 * 2026-11-25): Core writes the month's calendar after payment, in parallel,
 * sized to the plan bought and held to the pillars, so a strategy is ready
 * in a few minutes instead of twenty.
 */
export const cmoV22: SokoBotVersion = {
  ...cmoV21,
  id: "cmo-v22",
  name: "cmo-v22 · Cuso, the strategy first and the month after payment",
  createdAt: "2026-11-25",
  summary:
    "Cuso on cmo-v21 whose strategy is the plan and three to five example posts: once the owner pays, Core writes the whole month's calendar in parallel, every network at the plan's rate, each topic at its share and every funnel step, keeps the examples, and makes the posts as before.",
  whatsNew: [
    "Your strategy is ready in a few minutes, with a few example posts.",
    "Each plan now says how many posts it makes at least every month.",
    "Cuso plans your whole month right after you subscribe, topic by topic.",
  ],
  releaseNote:
    "Your strategy is now ready in a few minutes: you see the plan and a few example posts, each plan says how many posts it makes at least, and I plan the whole month right after you subscribe.",
  skills: cmoV21.skills.map((skill) =>
    skill === CMO_V21_STRATEGY_SKILL ? CMO_V22_STRATEGY_SKILL : skill,
  ),
};
