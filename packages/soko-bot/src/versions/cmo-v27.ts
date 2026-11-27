import { cmoV26 } from "./cmo-v26.js";
import type { SokoBotVersion } from "./types.js";

/**
 * A test version (Patrick, 2026-11-26): cmo-v26 with the plan loop on, and
 * nothing else changed, to benchmark the loop against cmo-v26 on one pin.
 */
export const cmoV27: SokoBotVersion = {
  ...cmoV26,
  id: "cmo-v27",
  name: "cmo-v27 · cmo-v26 with the plan loop (test)",
  createdAt: "2026-11-26",
  summary:
    "cmo-v26 with the plan loop on: Core keeps Cuso's plan for the whole owner request and sends an answer back once while the plan still has open steps. Nothing else differs from cmo-v26.",
  planLoop: true,
};
