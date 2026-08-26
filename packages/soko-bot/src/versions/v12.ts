import type { SokoBotVersion } from "./types.js";
import { v1 } from "./v1.js";

export const v12: SokoBotVersion = {
  ...v1,
  id: "v12",
  name: "v12 · Amazon Nova Pro, EU",
  createdAt: "2026-08-26",
  summary:
    "Experiment: v1 prompt and skills on Amazon Nova Pro pinned to EU inference (ZDR, no training; $0.80/$3.20 per M).",
  model: "amazon/nova-pro",
  inferenceRegion: "eu",
};
