import type { SokoBotVersion } from "./types.js";
import { v36 } from "./v36.js";

export const v37: SokoBotVersion = {
  ...v36,
  id: "v37",
  name: "v37 · Keep work moving and preserve owner goals",
  createdAt: "2026-11-14",
  summary:
    "Keeps goals and read answers intact, discovers available newsletters, and completes linked handoffs.",
  releaseNote:
    "I retain your goals, find the available newsletter, and track missing deliverables and verification as concrete follow-up work.",
  skills: [...v36.skills, "work-completion-v37"],
};
