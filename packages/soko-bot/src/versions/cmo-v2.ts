import { cmoV1 } from "./cmo-v1.js";
import type { SokoBotVersion } from "./types.js";

/**
 * The version new hires get: cmo-v1 with two skills swapped. The first read
 * runs the six Brand Brain groups side by side (SOKD-167), and the strategy
 * skill writes week one in full, weeks two to four as titles, and saves edits
 * as patches (SOKD-152). Cusos hired on cmo-v1 stay on it.
 */
export const cmoV2: SokoBotVersion = {
  ...cmoV1,
  id: "cmo-v2",
  name: "cmo-v2 · Cuso, parallel research and plan in pieces",
  createdAt: "2026-11-10",
  summary:
    "Cuso on cmo-v1, whose first read researches the six Brand Brain groups side by side, and whose first plan is short with edits saved as patches.",
  skills: cmoV1.skills.map((skill) =>
    skill === "cmo-brand-brain"
      ? "cmo-brand-brain-groups"
      : skill === "cmo-strategy"
        ? "cmo-strategy-patches"
        : skill,
  ),
};
