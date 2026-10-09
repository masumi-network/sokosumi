import type { SokoBotVersion } from "./types.js";
import { v22 } from "./v22.js";

export const v23: SokoBotVersion = {
  ...v22,
  id: "v23",
  name: "v23 · Social account performance",
  createdAt: "2026-10-08",
  summary:
    "v22 with account metrics and provider history, including posts published outside Sokosumi.",
  releaseNote:
    "I can evaluate connected Social accounts and their published content, including posts created elsewhere. I show account metrics, fetch available history, and explain the freshness, periods, and coverage of the results.",
  skills: [
    ...v22.skills.filter((skill) => skill !== "social-performance"),
    "social-account-performance",
  ],
};
