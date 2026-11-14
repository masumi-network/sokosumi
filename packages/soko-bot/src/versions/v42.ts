import type { SokoBotVersion } from "./types.js";
import { v41 } from "./v41.js";

export const v42: SokoBotVersion = {
  ...v41,
  id: "v42",
  name: "v42 · Resolve scope and report confirmed outcomes",
  createdAt: "2026-11-14",
  summary:
    "Investigates missing scope, gives bounded spending choices, and qualifies source and timing claims.",
  releaseNote:
    "I check the available scope before blocking work and explain costs, source limits and saved check times clearly.",
  skills: [...v41.skills, "bounded-follow-through-v42"],
};
