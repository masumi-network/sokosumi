import type { SokoBotVersion } from "./types.js";
import { v1 } from "./v1.js";

export const v11: SokoBotVersion = {
  ...v1,
  id: "v11",
  name: "v11 · Gemini 3.6 Flash, EU",
  createdAt: "2026-08-26",
  summary:
    "Experiment: v1 prompt and skills on Gemini 3.6 Flash pinned to EU inference (no training; $0.75/$3.75 per M).",
  model: "google/gemini-3.6-flash",
  inferenceRegion: "eu",
};
