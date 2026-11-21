import { cmoV9 } from "./cmo-v9.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v9 that runs his hard work on a stronger model (owner, 2026-11-21):
 * every strategy turn, chat Jev reads as complex, hires, multi-part requests
 * and background runs. The month's production and his rhythms stay on Luna.
 * Core picks the model once per turn (`turn-model.ts`).
 */
export const cmoV10: SokoBotVersion = {
  ...cmoV9,
  id: "cmo-v10",
  name: "cmo-v10 · Cuso, stronger model for hard work",
  createdAt: "2026-11-21",
  summary:
    "Cuso on cmo-v9 who writes and changes strategies on GPT-6.2 Sol, and runs complex requests, hires, multi-part asks and background runs there too; the month's production and his daily rhythms stay on GPT-6 Luna.",
  releaseNote:
    "I now plan your marketing strategy with a stronger model, and use it for complex questions, requests with several parts and long jobs I run in the background. Quick questions and my daily work stay as fast as before.",
  strongModel: "openai/gpt-6.2-sol",
};
