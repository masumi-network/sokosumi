import type { SokoBotVersion } from "./types.js";
import { v19 } from "./v19.js";

export const v22: SokoBotVersion = {
  ...v19,
  id: "v22",
  name: "v22 · Social performance",
  createdAt: "2026-10-08",
  summary:
    "v19 with a Social performance skill for cached statistics, bounded refreshes, and evidence-based comparisons.",
  releaseNote:
    "I can evaluate your published social posts with the metrics each connected platform makes available. I show when results were fetched, refresh relevant stale results, and explain missing metrics before comparing performance.",
  skills: [...v19.skills, "social-performance"],
};
