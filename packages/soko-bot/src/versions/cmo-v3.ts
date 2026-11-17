import { cmoV2 } from "./cmo-v2.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v2 with a fuller month (owner, 2026-11-16): every social network the
 * business is on gets pieces, plus up to two where its buyer is; the pace
 * counts pieces per network per day (all_in: three a day on X, two on the
 * others); ads are a test the owner chooses, asked as one; and every piece is
 * built from the Brand Brain's concrete material, saved week by week.
 */
export const cmoV3: SokoBotVersion = {
  ...cmoV2,
  id: "cmo-v3",
  name: "cmo-v3 · Cuso, every channel every day",
  createdAt: "2026-11-16",
  summary:
    "Cuso on cmo-v2, planning a fuller month: every network the business is on, up to two new ones, pieces per network per day from concrete material, saved week by week, and ads as a test the owner opts into.",
  skills: cmoV2.skills.map((skill) =>
    skill === "cmo-strategy-patches" ? "cmo-strategy-weekly" : skill,
  ),
};
