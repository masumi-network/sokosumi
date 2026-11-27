import { cmoV27 } from "./cmo-v27.js";
import type { SokoBotVersion } from "./types.js";
import { v40 } from "./v40.js";

/**
 * Opt-in E8 experiment test versions for ownerbench (never defaults).
 * Control (`v39`/`cmo-v26`) and loop-only (`v40`/`cmo-v27`) stay untouched so
 * `loop + E8` (`stallDetector: true`) can be benchmarked cleanly on one pin.
 */
export const v40E8: SokoBotVersion = {
  ...v40,
  id: "v40-e8",
  name: "v40-e8 · v40 with E8 stall detector (test)",
  createdAt: "2026-11-27",
  summary:
    "v40 with stallDetector on: the runner flags repeated identical calls, alternating A-B loops, and no-progress status polls with one corrective note and stops cleanly on a second fire. Nothing else differs from v40.",
  stallDetector: true,
};

export const cmoV27E8: SokoBotVersion = {
  ...cmoV27,
  id: "cmo-v27-e8",
  name: "cmo-v27-e8 · cmo-v27 with E8 stall detector (test)",
  createdAt: "2026-11-27",
  summary:
    "cmo-v27 with stallDetector on: the runner flags repeated identical calls, alternating A-B loops, and no-progress status polls with one corrective note and stops cleanly on a second fire. Nothing else differs from cmo-v27.",
  stallDetector: true,
};
