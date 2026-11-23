import { cmoV20 } from "./cmo-v20.js";
import { CMO_V20_STRATEGY_SKILL } from "./cmo-v20-skills.js";
import {
  CMO_INDUSTRY_SKILL,
  CMO_V21_STRATEGY_SKILL,
} from "./cmo-v21-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v20 with a content strategy about the buyer's industry (owner,
 * 2026-11-23): Core researches the industry's news, trends, problems and
 * competitors, the pillars are topics the buyers care about, and the product
 * comes in where it helps.
 */
export const cmoV21: SokoBotVersion = {
  ...cmoV20,
  id: "cmo-v21",
  name: "cmo-v21 · Cuso, about your buyers' industry",
  createdAt: "2026-11-23",
  summary:
    "Cuso on cmo-v20 whose posts are about the buyer's own world: Core researches the industry's news, trends, common problems and competitors with their sources, the topics come from that research instead of the product's pages, and most posts help buyers with their work while the product comes in where it helps.",
  whatsNew: [
    "Cuso now researches your buyers' industry: its news, trends, common problems and competitors.",
    "Most posts now help your buyers with their own work, and your product comes in where it helps.",
    "Every fact about your market comes with its source.",
  ],
  releaseNote:
    "I now research your buyers' industry before each month's strategy, so most posts help them with their own work, every fact about your market has its source, and your product comes in where it helps.",
  skills: [
    ...cmoV20.skills.map((skill) =>
      skill === CMO_V20_STRATEGY_SKILL ? CMO_V21_STRATEGY_SKILL : skill,
    ),
    CMO_INDUSTRY_SKILL,
  ],
};
