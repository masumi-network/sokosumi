import type { SokoBotVersion } from "./types.js";
import { v25 } from "./v25.js";

export const v26: SokoBotVersion = {
  ...v25,
  id: "v26",
  name: "v26 · Social performance insights",
  createdAt: "2026-10-20",
  summary:
    "v25 with X audience, public benchmark, topic discovery, and a performance alias over cached account statistics.",
  releaseNote:
    "I can read X audience samples, public handle benchmarks, and recent topic discovery through an authorized X connection, and I can list cached Social account performance with the same headline totals as account statistics. I state sample sizes, freshness, and platform limits.",
  skills: [...v25.skills, "social-performance-insights"],
};
