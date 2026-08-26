import type { SokoBotVersion } from "./types.js";
import { v1 } from "./v1.js";

export const v10: SokoBotVersion = {
  ...v1,
  id: "v10",
  name: "v10 · Claude Sonnet 5, EU",
  createdAt: "2026-08-26",
  summary:
    "Experiment: v1 prompt and skills on Claude Sonnet 5 pinned to EU inference (ZDR, no training; $2/$10 per M). Expected ceiling for tool discipline.",
  model: "anthropic/claude-sonnet-5",
  inferenceRegion: "eu",
};
