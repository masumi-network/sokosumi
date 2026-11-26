import { cmoV23 } from "./cmo-v23.js";
import { CMO_TOOL_HIGHLIGHTS_SKILL } from "./cmo-v24-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v23 whose turns name the tools they use and send the two big save
 * tools in a short form when a turn rarely saves (owner, 2026-11-25: "should
 * always be able to call all tools but it should get them highlighted"), and
 * whose prompt carries a skill index instead of all 19 skills (131 KB): each
 * kind of turn preloads the skills it always needs, the rest are read with
 * read_skill.
 */
export const cmoV24: SokoBotVersion = {
  ...cmoV23,
  id: "cmo-v24",
  name: "cmo-v24 · Cuso, skills and tools loaded by the turn",
  createdAt: "2026-11-25",
  summary:
    "Cuso on cmo-v23 whose core names the tools that fit the turn. On questions and events save_strategy and save_brand_brain come in a short form; calling one gives Cuso the full tool for the rest of the turn. The prompt lists the skills by one line each and carries in full only those the kind of turn always needs; Cuso reads the rest with read_skill.",
  whatsNew: ["Cuso answers questions faster and for less."],
  releaseNote: "I now answer questions faster, with less to read each time.",
  skills: [...cmoV23.skills, CMO_TOOL_HIGHLIGHTS_SKILL],
  skillsOnDemand: true,
};
