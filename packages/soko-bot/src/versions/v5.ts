import type { SokoBotVersion } from "./types.js";
import { v1 } from "./v1.js";

export const v5: SokoBotVersion = {
  ...v1,
  id: "v5",
  name: "v5 · Small, budget",
  createdAt: "2026-08-26",
  summary:
    "Experiment: v1 prompt and skills on Mistral Small (cheapest EU model). Tests whether the contract holds on a small model.",
  model: "mistral/mistral-small",
};
