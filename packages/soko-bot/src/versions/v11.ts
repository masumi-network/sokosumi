import type { SokoBotVersion } from "./types.js";
import { v1 } from "./v1.js";

export const v11: SokoBotVersion = {
  ...v1,
  id: "v11",
  name: "v11 · Gemini 3.6 Flash, EU",
  createdAt: "2026-08-26",
  summary:
    "Experiment: v1 prompt and skills on Gemini 3.6 Flash pinned to EU inference (no training; $0.75/$3.75 per M). Lab 2026-08-26: 9/9 checks, judge pass on 7 and weak on 2 — best result of any version so far. ~$0.04/turn, ~23s. Recommended default candidate.",
  model: "google/gemini-3.6-flash",
  inferenceRegion: "eu",
};
