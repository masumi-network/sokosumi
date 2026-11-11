import { cmoV1 } from "./cmo-v1.js";
import type { SokoBotVersion } from "./types.js";

/**
 * Preview only (SOKD-149): cmo-v1 with both changes in one version.
 * SOKD-167's first read runs in six parts at once, and SOKD-152's strategy
 * skill writes week one in full, weeks two to four as titles, and saves edits
 * as patches. On their own branches each is a separate cmo-v2.
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
