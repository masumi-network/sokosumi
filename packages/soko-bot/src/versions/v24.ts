import type { SokoBotVersion } from "./types.js";
import { v23 } from "./v23.js";

export const v24: SokoBotVersion = {
  ...v23,
  id: "v24",
  name: "v24 · Social performance insights",
  createdAt: "2026-10-08",
  summary:
    "v23 with complete-cohort comparisons, posting-time analysis, observed growth and evidence-based content feedback.",
  releaseNote:
    "I can compare Social content against typical results, explain recorded audience growth, find promising posting windows, and give content feedback using real performance evidence. I state sample sizes, freshness, and platform limits.",
  skills: [...v23.skills, "social-performance-insights"],
};
