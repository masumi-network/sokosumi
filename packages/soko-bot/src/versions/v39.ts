import type { SokoBotVersion } from "./types.js";
import { v38 } from "./v38.js";

export const v39: SokoBotVersion = {
  ...v38,
  id: "v39",
  name: "v39 · Check team and Project identity",
  createdAt: "2026-11-14",
  summary:
    "Checks current team membership, compares Project identity, and attributes read summaries to their sources.",
  releaseNote:
    "I check the current team and requested Project before answering, and distinguish reported updates from actions I took.",
  skills: [...v38.skills, "resource-identity-v39"],
};
