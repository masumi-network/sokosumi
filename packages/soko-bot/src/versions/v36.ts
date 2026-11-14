import type { SokoBotVersion } from "./types.js";
import { v35 } from "./v35.js";

export const v36: SokoBotVersion = {
  ...v35,
  id: "v36",
  name: "v36 · Preserve preferences and use verified inputs",
  createdAt: "2026-11-14",
  summary:
    "Keeps standing preferences during reflection, uses verified resource IDs, and links tables directly.",
  releaseNote:
    "I keep your standing preferences and use verified Task and Project inputs when I continue your work.",
  skills: [...v35.skills, "input-reliability-v36"],
};
