import { cmoV24 } from "./cmo-v24.js";
import { CMO_COMPACT_PRODUCTION_SKILL } from "./cmo-v26-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v24 whose production run works from a small context: the production
 * tools only, the marketing part of the packet, and the writing skills by id
 * (postpay, 2026-11-26: a month cost about 105k input tokens a piece, almost
 * all of it Cuso's own production steps at about 109k each).
 */
export const cmoV26: SokoBotVersion = {
  ...cmoV24,
  id: "cmo-v26",
  name: "cmo-v26 · Cuso, a month made from a small context",
  createdAt: "2026-11-26",
  summary:
    "Cuso on cmo-v24 whose production run carries only the production tools, the marketing part of the packet and the writing skills by id, and reads the rest.",
  whatsNew: ["Cuso makes your month faster and for less."],
  releaseNote: "I now make your month faster, with less to read each time.",
  skills: [...cmoV24.skills, CMO_COMPACT_PRODUCTION_SKILL],
};
