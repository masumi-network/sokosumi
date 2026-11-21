import type { SokoBotVersion } from "./types.js";
import { v33 } from "./v33.js";

/**
 * v33 that runs hard work on a stronger model (owner, 2026-11-21): background
 * runs, hires, multi-part requests and chat Jev reads as complex, and it stays
 * there while the conversation stays complex. Rhythms, mail and memory stay
 * on Luna. Core picks the model once per turn (`turn-model.ts`).
 */
export const v34: SokoBotVersion = {
  ...v33,
  id: "v34",
  name: "v34 · Stronger model for hard work",
  createdAt: "2026-11-21",
  summary:
    "v33 that runs background runs, hires, multi-part requests and chat Jev reads as complex on a stronger model, and stays on it while the conversation stays complex. Stand-ups, mail, dreaming and other rhythms stay on GPT-6 Luna.",
  releaseNote:
    "I now think harder on hard work: background runs, hiring, requests with several parts and complex questions run on a stronger model. Quick questions and my daily rhythms stay as fast as before.",
  strongModel: "openai/gpt-6.1-terra",
};
