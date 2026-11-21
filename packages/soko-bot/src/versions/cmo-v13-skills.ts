import type { SokoBotSkill } from "./skills.js";

/** cmo-v13's strategy skill: cmo-v8's, with every change to part of the plan saved as a part patch. */
export const CMO_PART_PATCH_STRATEGY_SKILL = "cmo-strategy-part-patch";

const PATCH_RULE =
  "A patch (an owner's no, a new pace, an ad budget, a Brand Brain fix) changes only the entries and fields it touches, with part patch.";

/**
 * NMKR, 2026-11-21: "2 a day on X" was told to resend the whole calendar,
 * which a 160-entry month does not fit in Cuso's context, so he asked the
 * owner for "the full strategy calendar".
 */
const PART_PATCH_RULE =
  "Every change the owner asks for to part of the plan (a no, a new pace, a network's cadence, a week, an ad budget, a Brand Brain fix) is a patch: it changes only the entries and fields it touches, with part patch. Send only the entries you change, never the whole calendar, and never ask the owner for the calendar: the strategy in your packet is the one to change.";

/** `base` is cmo-v8's claims strategy skill. */
export function partPatchStrategy(base: SokoBotSkill): SokoBotSkill {
  if (!base.content.includes(PATCH_RULE))
    throw new Error(
      `${CMO_PART_PATCH_STRATEGY_SKILL}: no patch rule in ${base.id}`,
    );
  return {
    ...base,
    id: CMO_PART_PATCH_STRATEGY_SKILL,
    content: base.content.replace(PATCH_RULE, PART_PATCH_RULE),
  };
}
