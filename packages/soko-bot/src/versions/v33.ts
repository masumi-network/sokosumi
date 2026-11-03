import type { SokoBotVersion } from "./types.js";
import { v32 } from "./v32.js";

export const v33: SokoBotVersion = {
  ...v32,
  id: "v33",
  name: "v33 · Posting instructions",
  createdAt: "2026-10-27",
  summary:
    "v32 that also reads a Project's posting instructions via get_posting_instructions before drafting or rewriting Social posts, following tone, hashtags, calls to action, and per-platform ## sections. Keeps v32's newsletter behaviour up to approval.",
  releaseNote:
    "I now read your Project's posting instructions with get_posting_instructions before drafting or rewriting Social posts, following your tone, hashtags, calls to action, and each platform's ## section. I still help with your newsletter up to approval; you approve, schedule and send every issue yourself.",
  skills: v32.skills.map((skill) =>
    skill === "social" ? "social-posting-instructions" : skill,
  ),
};
