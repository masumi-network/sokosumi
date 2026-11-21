import { CMO_BATCHED_PRODUCTION_SKILL } from "./cmo-skills.js";
import { EVERY_NETWORK_STRATEGY_SKILL } from "./cmo-strategy-every-network.js";
import { cmoV7 } from "./cmo-v7.js";
import {
  CMO_CLAIMS_STRATEGY_SKILL,
  CMO_VARIED_PRODUCTION_SKILL,
} from "./cmo-v8-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v7 whose month says more than one thing (owner, 2026-11-20). NMKR's
 * month showed one panel diagram after another (56 of 69 pictures from
 * infographics) and made one point in most posts; a no to ballcaps left caps
 * in the funnel; cal.com's LinkedIn posts opened on advice. Each piece now
 * argues its own claim, pictures vary their kind, a correction reaches every
 * field, and a LinkedIn post opens on a result. Core checks each of these.
 */
export const cmoV8: SokoBotVersion = {
  ...cmoV7,
  id: "cmo-v8",
  name: "cmo-v8 · Cuso, varied pictures and messages",
  createdAt: "2026-11-20",
  summary:
    "Cuso on cmo-v7 whose pieces each argue their own claim, whose pictures vary their kind (an infographic only for numbers, at most one in four), whose corrections reach every part of the strategy, and whose LinkedIn posts open on a result, a number, a customer or a decision.",
  releaseNote:
    "Your month now says more than one thing: every post makes its own point, the pictures vary from posters to old ads instead of one diagram after another, a correction you make changes every part of the strategy it touches, and LinkedIn posts open with a result.",
  skills: cmoV7.skills.map((skill) =>
    skill === EVERY_NETWORK_STRATEGY_SKILL
      ? CMO_CLAIMS_STRATEGY_SKILL
      : skill === CMO_BATCHED_PRODUCTION_SKILL
        ? CMO_VARIED_PRODUCTION_SKILL
        : skill,
  ),
};
