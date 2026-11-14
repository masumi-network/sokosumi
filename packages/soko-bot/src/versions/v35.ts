import type { SokoBotVersion } from "./types.js";
import { v34 } from "./v34.js";

export const v35: SokoBotVersion = {
  ...v34,
  id: "v35",
  name: "v35 · Complete recovery with faithful evidence",
  createdAt: "2026-11-14",
  summary:
    "Delivers Task recovery and verification follow-ups, preserves reported findings, and links one-time checks to their Tasks.",
  releaseNote:
    "I send recovery guidance to the Task, keep reported findings distinct from verified facts, and link check-ins to the work they monitor.",
  skills: [...v34.skills, "work-recovery-v35"],
};
