import { CMO_BATCHED_PRODUCTION_SKILL } from "./cmo-skills.js";
import { cmoV5 } from "./cmo-v5.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v5 whose month is written by Core at once (owner, 2026-11-20). On
 * cmo-v5 a production run wrote about two posts a minute, one tool call
 * each, and NMKR's 171 posts took four runs. Here the run calls
 * write_month_pieces: Core writes the pieces in parallel structured calls on
 * this version's model, checks and saves them like Cuso's own saves, and
 * Cuso fixes only what it hands back.
 */
export const cmoV6: SokoBotVersion = {
  ...cmoV5,
  id: "cmo-v6",
  name: "cmo-v6 · Cuso, whose month is written at once",
  createdAt: "2026-11-20",
  summary:
    "Cuso on cmo-v5 whose production run has Core write the month's pieces many at once, checked like his own saves, and fixes only the pieces it hands back.",
  releaseNote:
    "Once you approve your plan, your whole month is written in minutes instead of hours, and the pictures follow right after.",
  skills: cmoV5.skills.map((skill) =>
    skill === "cmo-production" ? CMO_BATCHED_PRODUCTION_SKILL : skill,
  ),
};
