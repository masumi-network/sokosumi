import { cmoV23 } from "./cmo-v23.js";
import { CMO_STRATEGY_STEP_SKILL } from "./cmo-v25-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v23 whose strategy Core writes in one step (owner, 2026-11-25): one
 * structured call writes the plan and its examples, Core runs every check on
 * the whole plan at once, one call fixes what they found, and Core saves it.
 * No finish or fix turns follow. Rebases onto cmo-v24 once that lands.
 */
export const cmoV25: SokoBotVersion = {
  ...cmoV23,
  id: "cmo-v25",
  name: "cmo-v25 · Cuso, the strategy written in one step",
  createdAt: "2026-11-25",
  summary:
    "Cuso on cmo-v23 whose strategy Core writes in one step: one call writes the whole plan and its example posts, Core checks all of it against every rule at once, one more call fixes what the checks found, and Core saves it. The owner's changes go through the same step.",
  whatsNew: [
    "Your strategy is ready faster, already checked against every rule.",
    "Changes you ask for are checked the same way before they are saved.",
  ],
  releaseNote:
    "Your strategy is now ready faster and already checked against every rule, and the changes you ask for are checked the same way before I save them.",
  skills: [...cmoV23.skills, CMO_STRATEGY_STEP_SKILL],
};
