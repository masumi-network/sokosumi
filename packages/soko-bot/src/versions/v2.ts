import type { SokoBotVersion } from "./types.js";
import { v1 } from "./v1.js";

export const v2: SokoBotVersion = {
  ...v1,
  id: "v2",
  name: "v2 · Medium 3.5",
  createdAt: "2026-08-25",
  summary:
    "Same prompt and skills as v1 on Mistral Medium 3.5 (faster, ~4x the cost).",
  model: "mistral/mistral-medium-3.5",
};
