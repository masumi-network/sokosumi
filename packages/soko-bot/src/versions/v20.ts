import type { SokoBotVersion } from "./types.js";
import { v19 } from "./v19.js";

/**
 * v19's prompt on Gemini 3.8 Flash, pinned to the EU. For owners who need EU
 * data residency: it was the behaviour lab's strongest EU model.
 */
export const v20: SokoBotVersion = {
  ...v19,
  id: "v20",
  name: "v20 · v19 in the EU (Gemini 3.8 Flash)",
  createdAt: "2026-09-29",
  model: "google/gemini-3.8-flash",
  inferenceRegion: "eu",
  summary:
    "v19's prompt and tools on Gemini 3.8 Flash, with inference pinned to the EU.",
};
