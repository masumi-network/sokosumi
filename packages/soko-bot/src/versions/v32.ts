import type { SokoBotVersion } from "./types.js";
import { v31 } from "./v31.js";

export const v32: SokoBotVersion = {
  ...v31,
  id: "v32",
  name: "v32 · Social performance insights",
  createdAt: "2026-10-26",
  summary:
    "v31 with X audience, public benchmark, topic discovery, and a performance alias over cached account statistics.",
  releaseNote:
    "I can read X audience samples, public handle benchmarks, and recent topic discovery through an authorized X connection, and I can list cached Social account performance with the same headline totals as account statistics. I state sample sizes, freshness, and platform limits.",
  skills: [...v31.skills, "social-performance-insights"],
};
