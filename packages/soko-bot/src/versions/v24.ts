import type { SokoBotVersion } from "./types.js";
import { v23 } from "./v23.js";

export const v24: SokoBotVersion = {
  ...v23,
  id: "v24",
  name: "v24 · Social performance insights",
  createdAt: "2026-10-11",
  summary:
    "v23 with X audience, public benchmark, topic discovery, and a performance alias over cached account statistics.",
  releaseNote:
    "I can read X audience samples, public handle benchmarks, and recent topic discovery through an authorized X connection, and I can list cached Social account performance with the same headline totals as account statistics. I state sample sizes, freshness, and platform limits.",
  skills: [...v23.skills, "social-performance-insights"],
};
