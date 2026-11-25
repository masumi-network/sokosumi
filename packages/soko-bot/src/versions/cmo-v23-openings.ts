import { CMO_PICKED_OPENINGS_SKILL } from "./cmo-openings-skills.js";
import { cmoV23 } from "./cmo-v23.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v23 whose month writer picks each post's first line from five and
 * reads the brand's best posts (owner, 2026-11-25). A trial to compare in
 * the evals; the next numbered Cuso version takes its skill.
 */
export const cmoV23Openings: SokoBotVersion = {
  ...cmoV23,
  id: "cmo-v23-openings",
  name: "cmo-v23 with picked openings · trial",
  createdAt: "2026-11-25",
  summary:
    "Cuso's cmo-v23 whose month writer writes five first lines for every post and keeps the strongest, and reads the posts that did best for the business and its competitors. Nobody is hired onto it.",
  skills: [...cmoV23.skills, CMO_PICKED_OPENINGS_SKILL],
};
