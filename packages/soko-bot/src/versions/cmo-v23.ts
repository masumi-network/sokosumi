import { cmoV22 } from "./cmo-v22.js";
import { CMO_CONTEXT_ON_DEMAND_SKILL } from "./cmo-v23-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v22 with a small context organized before each turn (owner,
 * 2026-11-25): a fixed core and a map of what is stored, what this turn
 * needs picked on top, and read tools for the rest.
 */
export const cmoV23: SokoBotVersion = {
  ...cmoV22,
  id: "cmo-v23",
  name: "cmo-v23 · Cuso, a short context and reads for the rest",
  createdAt: "2026-11-25",
  summary:
    "Cuso on cmo-v22 whose every turn starts from a short summary of the business and a map of what is stored. Core adds what the turn needs, and Cuso reads any piece, week, report, strategy part or Brand Brain section before he answers about it.",
  whatsNew: [
    "Cuso now looks up the exact post, week or report you ask about.",
    "Replies come faster, because each one reads only what it needs.",
  ],
  releaseNote:
    "I now look up the exact post, week or report you ask about before I answer, and each reply reads only what it needs.",
  skills: [...cmoV22.skills, CMO_CONTEXT_ON_DEMAND_SKILL],
};
