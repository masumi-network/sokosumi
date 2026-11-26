import { CMO_PLAYBOOKS_SKILL } from "./cmo-playbooks-skill.js";
import { cmoV24 } from "./cmo-v24.js";
import { CMO_STRATEGY_STEP_SKILL } from "./cmo-v25-skills.js";
import { CMO_COMPACT_PRODUCTION_SKILL } from "./cmo-v26-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * The next Cuso default candidate, one version for the line (coordinator,
 * 2026-11-26): cmo-v24 (skills on demand, a cacheable prompt, tool
 * highlights and short save tools), cmo-v25's strategy written in one Core
 * step, the pages, outreach and growth playbooks (read on demand), and a
 * production run that works from a small context (postpay: a month cost
 * about 105k input tokens a piece, almost all of it Cuso's own production
 * steps at about 109k each).
 */
export const cmoV26: SokoBotVersion = {
  ...cmoV24,
  id: "cmo-v26",
  name: "cmo-v26 · Cuso, skills on demand, the strategy in one step, a lean month",
  createdAt: "2026-11-26",
  summary:
    "Cuso on cmo-v24 whose strategy Core writes, checks and saves in one step (cmo-v25), who reads playbooks for pages, outreach and growth work, and whose production run carries only the production tools, the marketing part of the packet and the writing skills by id.",
  whatsNew: [
    "Your strategy is ready faster, already checked against every rule.",
    "Cuso can write pages, emails, launches and offers by proven playbooks.",
    "Cuso answers and makes your month faster and for less.",
  ],
  releaseNote:
    "Your strategy is now ready faster and already checked against every rule. I write pages, emails, launches and offers by proven playbooks, and I answer and make your month faster, with less to read each time.",
  skills: [
    ...cmoV24.skills,
    CMO_STRATEGY_STEP_SKILL,
    CMO_PLAYBOOKS_SKILL,
    CMO_COMPACT_PRODUCTION_SKILL,
  ],
};
