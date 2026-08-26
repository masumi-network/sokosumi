import type { SokoBotVersion } from "./types.js";
import { v1 } from "./v1.js";

export const v8: SokoBotVersion = {
  ...v1,
  id: "v8",
  name: "v8 · Magistral Medium, reasoning",
  createdAt: "2026-08-26",
  summary:
    "Experiment: v1 prompt and skills on Magistral Medium (EU reasoning model). Tests whether built-in reasoning reduces judgment errors on multi-step scenarios.",
  model: "mistral/magistral-medium",
};
