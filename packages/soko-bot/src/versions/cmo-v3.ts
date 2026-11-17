import { cmoV1 } from "./cmo-v1.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v1 with a fuller month (owner, 2026-11-16): every social network the
 * business is on gets pieces, plus up to two where its buyer is; the pace
 * counts pieces per network per day (all_in: three a day on X, two on the
 * others); ads are a test the owner chooses, asked as one; and every piece is
 * built from the Brand Brain's concrete material, saved week by week.
 * (cmo-v2 is the name of the parallel-research version in review.)
 */
export const cmoV3: SokoBotVersion = {
  ...cmoV1,
  id: "cmo-v3",
  name: "cmo-v3 · Cuso, every channel every day",
  createdAt: "2026-11-16",
  summary:
    "Cuso on cmo-v1, planning a fuller month: every network the business is on, up to two new ones, pieces per network per day from concrete material, and ads as a test the owner opts into.",
  skills: cmoV1.skills.map((skill) =>
    skill === "cmo-strategy" ? "cmo-strategy-v3" : skill,
  ),
};
