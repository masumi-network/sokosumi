import type { SokoBotVersion } from "./types.js";
import { v18 } from "./v18.js";

/**
 * v18's prompt on Gemini 3.8 Flash, pinned to the EU. For owners who need EU
 * data residency: it was the behaviour lab's strongest EU model.
 */
export const v19: SokoBotVersion = {
  ...v18,
  id: "v19",
  name: "v19 · v18 in the EU (Gemini 3.8 Flash)",
  createdAt: "2026-09-29",
  model: "google/gemini-3.8-flash",
  inferenceRegion: "eu",
  summary:
    "v18's prompt and tools on Gemini 3.8 Flash, with inference pinned to the EU.",
};
