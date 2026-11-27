import { cmoV27 } from "./cmo-v27.js";
import type { SokoBotVersion } from "./types.js";
import { v40 } from "./v40.js";

/**
 * Opt-in E5 experiment test versions for ownerbench (never defaults).
 * Control (`v39`/`cmo-v26`) and loop-only (`v40`/`cmo-v27`) stay untouched so
 * `loop + E5` (`typedToolErrors: true`) can be benchmarked cleanly on one pin.
 */
export const v40E5: SokoBotVersion = {
  ...v40,
  id: "v40-e5",
  name: "v40-e5 · v40 with E5 typed tool errors (test)",
  createdAt: "2026-11-27",
  summary:
    "v40 with typedToolErrors on: Core classifies tool failures and injects one fresh recovery hint per failed step. Nothing else differs from v40.",
  typedToolErrors: true,
};

export const cmoV27E5: SokoBotVersion = {
  ...cmoV27,
  id: "cmo-v27-e5",
  name: "cmo-v27-e5 · cmo-v27 with E5 typed tool errors (test)",
  createdAt: "2026-11-27",
  summary:
    "cmo-v27 with typedToolErrors on: Core classifies tool failures and injects one fresh recovery hint per failed step. Nothing else differs from cmo-v27.",
  typedToolErrors: true,
};
