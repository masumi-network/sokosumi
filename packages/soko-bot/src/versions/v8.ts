import type { SokoBotVersion } from "./types.js";
import { v1 } from "./v1.js";

export const v8: SokoBotVersion = {
  ...v1,
  id: "v8",
  name: "v8 · Magistral Medium, reasoning",
  createdAt: "2026-08-26",
  summary:
    "Experiment: v1 prompt and skills on Magistral Medium. Lab 2026-08-26: model id not available on the AI Gateway (every turn MODEL_CALL_FAILED); keep for when it lands.",
  model: "mistral/magistral-medium",
};
