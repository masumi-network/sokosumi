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
  releaseNote:
    "I now do quick look-ups and small drafts myself, show you exactly what I'd change and ask before doing it, and stay quiet when there's nothing new. I link only pages I actually opened. I run on Gemini 3.8 Flash, with everything processed inside the EU.",
};
