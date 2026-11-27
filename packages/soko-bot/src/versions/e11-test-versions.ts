import { cmoV27 } from "./cmo-v27.js";
import type { SokoBotVersion } from "./types.js";
import { v40 } from "./v40.js";

/**
 * Opt-in E11 experiment test versions for ownerbench (never defaults).
 * Control (`v39`/`cmo-v26`) and loop-only (`v40`/`cmo-v27`) stay untouched so
 * `loop + E11` (`effortFloor: true`) can be benchmarked cleanly on one pin.
 */
export const v40E11: SokoBotVersion = {
  ...v40,
  id: "v40-e11",
  name: "v40-e11 · v40 with the E11 effort floor (test)",
  createdAt: "2026-11-27",
  summary:
    "v40 with effortFloor on: the owner's own foreground chat turns run at the provider's default reasoning effort (medium), never low. Background runs, wakes and schedules keep low. Nothing else differs from v40.",
  effortFloor: true,
};

export const cmoV27E11: SokoBotVersion = {
  ...cmoV27,
  id: "cmo-v27-e11",
  name: "cmo-v27-e11 · cmo-v27 with the E11 effort floor (test)",
  createdAt: "2026-11-27",
  summary:
    "cmo-v27 with effortFloor on: the owner's own foreground chat turns run at the provider's default reasoning effort (medium), never low. Background runs, wakes and schedules keep low. Nothing else differs from cmo-v27.",
  effortFloor: true,
};
