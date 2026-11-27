import type { SokoBotVersion } from "./types.js";
import { v39 } from "./v39.js";

/**
 * A test version (Patrick, 2026-11-26): v39 with the plan loop on, and
 * nothing else changed, to benchmark the loop against v39 on one pin.
 */
export const v40: SokoBotVersion = {
  ...v39,
  id: "v40",
  name: "v40 · v39 with the plan loop (test)",
  createdAt: "2026-11-27",
  summary:
    "v39 with the plan loop on: Core keeps the bot's plan for the whole owner request and sends an answer back once while the plan still has open steps. Nothing else differs from v39.",
  planLoop: true,
};
