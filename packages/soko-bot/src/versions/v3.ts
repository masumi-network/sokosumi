import type { SokoBotVersion } from "./types.js";
import { v1 } from "./v1.js";

export const v3: SokoBotVersion = {
  ...v1,
  id: "v3",
  name: "v3 · Devstral 2",
  createdAt: "2026-08-25",
  summary:
    "Same prompt and skills as v1 on Devstral 2 (cheapest; skipped the agent input schema before hiring in the lab).",
  model: "mistral/devstral-2",
};
