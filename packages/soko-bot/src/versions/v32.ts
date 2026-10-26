import type { SokoBotVersion } from "./types.js";
import { v31 } from "./v31.js";

export const v32: SokoBotVersion = {
  ...v31,
  id: "v32",
  name: "v32 · Newsletter",
  createdAt: "2026-10-26",
  summary:
    "v31 that runs a Project's newsletter up to approval: reads issues, subscribers and results, drafts, edits, previews and submits issues, and changes settings and subscribers only on the owner's word. Approving, scheduling and sending stay with a person.",
  releaseNote:
    "I can now help with your newsletter: write and edit issues, preview them, and send them to you for approval. You still approve, schedule and send every issue yourself in the Newsletter page. I change sender details or subscribers only when you tell me to.",
  skills: [...v31.skills, "newsletter"],
};
