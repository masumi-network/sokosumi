import type { SokoBotVersion } from "./types.js";
import { v40 } from "./v40.js";

export const v41: SokoBotVersion = {
  ...v40,
  id: "v41",
  name: "v41 · Act on useful evidence",
  createdAt: "2026-11-14",
  summary:
    "Prepares bounded meeting work, reports verified progress, and stays quiet when nothing needs attention.",
  releaseNote:
    "I use meeting context to prepare useful work and distinguish assigned Tasks from actual progress.",
  skills: [...v40.skills, "proactive-evidence-v41"],
};
