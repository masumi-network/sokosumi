import { EVERY_NETWORK_STRATEGY_SKILL } from "./cmo-strategy-every-network.js";
import { cmoV4 } from "./cmo-v4.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v4 with a strategy on every network and a funnel the owner knows
 * (owner, 2026-11-18 and 2026-11-19). Every live social network CMO offers
 * is planned, with or without an account, at cmo-v3's pace per network and
 * saved week by week; one that does not fit the buyer is left out with its
 * reason. The funnel is always Awareness, Interest, Desire, Action, each
 * saying in one sentence what Cuso does there and what the owner does.
 * Core's strategy review holds a Cuso on this skill to both.
 */
export const cmoV5: SokoBotVersion = {
  ...cmoV4,
  id: "cmo-v5",
  name: "cmo-v5 · Cuso, every network and the classic funnel",
  createdAt: "2026-11-19",
  summary:
    "Cuso on cmo-v4, who plans every live social network CMO offers at a pace per network, and whose funnel is always Awareness, Interest, Desire and Action with what he does and what the owner does.",
  releaseNote:
    "I now plan every network we offer, also the ones you have no account on yet: those posts wait ready until you connect. And your funnel has the four stages you know: Awareness, Interest, Desire, Action.",
  skills: cmoV4.skills.map((skill) =>
    skill === "cmo-strategy-patches" ? EVERY_NETWORK_STRATEGY_SKILL : skill,
  ),
};
