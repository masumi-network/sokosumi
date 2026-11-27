import { cmoV27 } from "./cmo-v27.js";
import type { SokoBotVersion } from "./types.js";
import { v40 } from "./v40.js";

/**
 * Opt-in E1 experiment test versions for ownerbench (never defaults).
 * Control (`v39`/`cmo-v26`) and loop-only (`v40`/`cmo-v27`) stay untouched so
 * each E1 axis can be benchmarked cleanly on one frozen pin:
 * - `*-e1-route`: loop + routeSteering (Option D + keel menu, classifier fixed at v3)
 * - `*-e1-v4`: loop + routeSteering + classifierPolicy "v4"
 * - `v40-e1`: full E1 package (loop + routeSteering + classifierPolicy "v4" + e1Prompts + askPolicy)
 * - `cmo-v27-e1`: full E1 + Cuso package (loop + routeSteering + classifierPolicy "v4" + e1Prompts + askPolicy + cmoOwnerAudience + cmoApplyChanges)
 */

export const v40E1Route: SokoBotVersion = {
  ...v40,
  id: "v40-e1-route",
  name: "v40-e1-route · v40 with E1 route steering (test)",
  createdAt: "2026-11-27",
  summary:
    "v40 with E1 routeSteering (Option D + keel menu rule) enabled and classifier fixed at legacy v3.",
  routeSteering: true,
};

export const v40E1V4: SokoBotVersion = {
  ...v40,
  id: "v40-e1-v4",
  name: "v40-e1-v4 · v40 with E1 route steering and classifier v4 (test)",
  createdAt: "2026-11-27",
  summary:
    "v40 with E1 routeSteering (Option D + keel menu rule) and classifierPolicy v4 enabled.",
  routeSteering: true,
  classifierPolicy: "v4",
};

export const v40E1: SokoBotVersion = {
  ...v40,
  id: "v40-e1",
  name: "v40-e1 · v40 with full E1 (route steering, classifier v4, E1 prompts, ask policy) (test)",
  createdAt: "2026-11-27",
  summary:
    "v40 with all personal-bot E1 flags enabled: routeSteering, classifierPolicy v4, e1Prompts, and askPolicy.",
  routeSteering: true,
  classifierPolicy: "v4",
  e1Prompts: true,
  askPolicy: true,
};

export const cmoV27E1Route: SokoBotVersion = {
  ...cmoV27,
  id: "cmo-v27-e1-route",
  name: "cmo-v27-e1-route · cmo-v27 with E1 route steering (test)",
  createdAt: "2026-11-27",
  summary:
    "cmo-v27 with E1 routeSteering (Option D + keel menu rule) enabled and classifier fixed at legacy v3.",
  routeSteering: true,
};

export const cmoV27E1V4: SokoBotVersion = {
  ...cmoV27,
  id: "cmo-v27-e1-v4",
  name: "cmo-v27-e1-v4 · cmo-v27 with E1 route steering and classifier v4 (test)",
  createdAt: "2026-11-27",
  summary:
    "cmo-v27 with E1 routeSteering (Option D + keel menu rule) and classifierPolicy v4 enabled.",
  routeSteering: true,
  classifierPolicy: "v4",
};

export const cmoV27E1: SokoBotVersion = {
  ...cmoV27,
  id: "cmo-v27-e1",
  name: "cmo-v27-e1 · cmo-v27 with full E1 and Cuso flags (test)",
  createdAt: "2026-11-27",
  summary:
    "cmo-v27 with all E1 and Cuso flags enabled: routeSteering, classifierPolicy v4, e1Prompts, askPolicy, cmoOwnerAudience, and cmoApplyChanges.",
  routeSteering: true,
  classifierPolicy: "v4",
  e1Prompts: true,
  cmoOwnerAudience: true,
  askPolicy: true,
  cmoApplyChanges: true,
};
