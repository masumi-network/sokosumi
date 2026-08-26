import type { SokoBotVersion } from "./types.js";
import { v1 } from "./v1.js";

export const v9: SokoBotVersion = {
  ...v1,
  id: "v9",
  name: "v9 · Claude Haiku 4.5, EU",
  createdAt: "2026-08-26",
  summary:
    "Experiment: v1 prompt and skills on Claude Haiku 4.5 pinned to EU inference on the AI Gateway (ZDR, no training; $1/$5 per M).",
  model: "anthropic/claude-haiku-4.5",
  inferenceRegion: "eu",
};
