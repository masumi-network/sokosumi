import type { SokoBotSkill } from "./skills.js";

/** cmo-v20's strategy skill: cmo-v15's, every funnel step on every network. */
export const CMO_STAGE_SPREAD_STRATEGY_SKILL = "cmo-strategy-stage-spread";

/** cmo-v14's rule this one replaces (owner, 2026-11-23: "every network carries every step"). */
const ONE_STAGE_RULE =
  "Every social network sits at the one stage its posts serve (awareness, interest or desire; its offer posts may also go at action), so each stage says what its own posts do and no play shows up twice;";

const SPREAD_RULE =
  "Every social network carries every step: each network's posts help people find the business, look at what it offers, want it and take the offer. A network may lean toward what it does best (short videos toward finding out, proof posts toward wanting it), but it is never pinned to one step. Each stage's plays say what its posts do, across the networks;";

const SECTION = `

# Every step on every network

Give each calendar entry the funnel step it serves in stage: awareness, interest, desire or action. Spread each network's pieces across the steps; the share of the month at each step is what the owner sees in the funnel, so plan it on purpose (most pieces help people find out and look, fewer ask for the offer). The strategy review refuses an entry without a stage and a network whose pieces all serve one step.`;

/** `base` is cmo-v15's plain-words strategy skill. */
export function stageSpreadStrategy(base: SokoBotSkill): SokoBotSkill {
  if (!base.content.includes(ONE_STAGE_RULE))
    throw new Error(
      `${CMO_STAGE_SPREAD_STRATEGY_SKILL}: the one-stage rule is not in ${base.id}`,
    );
  return {
    ...base,
    id: CMO_STAGE_SPREAD_STRATEGY_SKILL,
    content: `${base.content.replace(ONE_STAGE_RULE, SPREAD_RULE)}${SECTION}`,
  };
}
