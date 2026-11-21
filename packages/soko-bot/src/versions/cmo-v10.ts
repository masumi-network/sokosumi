import { cmoV9 } from "./cmo-v9.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v9 that runs his hard work on a stronger model (owner, 2026-11-21):
 * chat Jev reads as complex, hires, multi-part requests and background runs.
 * Strategy writing, the month's production and his rhythms stay on Luna.
 * Core picks the model once per turn (`turn-model.ts`).
 */
export const cmoV10: SokoBotVersion = {
  ...cmoV9,
  id: "cmo-v10",
  name: "cmo-v10 · Cuso, stronger model for hard work",
  createdAt: "2026-11-21",
  summary:
    "Cuso on cmo-v9 whose complex requests, hires, multi-part asks and background runs run on GPT-6.2 Sol; strategy writing, the month's production and his daily rhythms stay on GPT-6 Luna.",
  releaseNote:
    "I now think harder on hard requests: complex questions, requests with several parts and long jobs I run in the background use a stronger model. Quick questions and my daily work stay as fast as before.",
  strongModel: "openai/gpt-6.2-sol",
};
