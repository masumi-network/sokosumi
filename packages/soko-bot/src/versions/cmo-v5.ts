import { AIDA_STRATEGY_SKILL } from "./cmo-strategy-aida.js";
import { cmoV4 } from "./cmo-v4.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v4 with the funnel in the four classic stages (owner, 2026-11-18):
 * Awareness, Interest, Desire, Action, always all four and in that order,
 * each saying in one sentence what Cuso does there and what the owner does.
 * Cuso's own stage names are gone. Core's strategy review holds a Cuso on
 * this skill to it.
 */
export const cmoV5: SokoBotVersion = {
  ...cmoV4,
  id: "cmo-v5",
  name: "cmo-v5 · Cuso, the funnel in four classic stages",
  createdAt: "2026-11-18",
  summary:
    "Cuso on cmo-v4, whose funnel is always Awareness, Interest, Desire and Action, each with what he does there and what the owner does.",
  releaseNote:
    "Your funnel now has the four stages you know: Awareness, Interest, Desire, Action. For each one I say what I do and what you do.",
  skills: cmoV4.skills.map((skill) =>
    skill === "cmo-strategy-patches" ? AIDA_STRATEGY_SKILL : skill,
  ),
};
