import type { SokoBotVersion } from "./types.js";
import { v39 } from "./v39.js";

export const v40: SokoBotVersion = {
  ...v39,
  id: "v40",
  name: "v40 · Complete verified work and report its limits",
  createdAt: "2026-11-14",
  summary:
    "Uses typed assignee references, completes safe recovery, and checks language, source limits and draft instructions.",
  releaseNote:
    "I use the right assignment field and explain what can proceed, what remains blocked, and what my sources support.",
  skills: [...v39.skills, "verified-follow-through-v40"],
};
