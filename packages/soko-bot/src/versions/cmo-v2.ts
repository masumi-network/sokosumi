import { cmoV1 } from "./cmo-v1.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v1 with the strategy skill of SOKD-152: the first plan writes week one
 * in full and weeks two to four as titles, a save that breaks a hard rule
 * (20-word summary, 16 pieces, shares within 7 points) is refused, and an
 * owner's no, a pace, an ad budget or a Brand Brain fix is saved as a patch
 * that changes only the entries it touches. Same prompt, tools and model.
 */
export const cmoV2: SokoBotVersion = {
  ...cmoV1,
  id: "cmo-v2",
  name: "cmo-v2 · Cuso, plan in pieces",
  createdAt: "2026-11-10",
  summary:
    "Cuso on cmo-v1, with a short first plan (week one in full) and edits saved as patches that change only what they touch.",
  skills: cmoV1.skills.map((skill) =>
    skill === "cmo-strategy" ? "cmo-strategy-patches" : skill,
  ),
};
