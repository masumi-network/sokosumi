import type { SokoBotVersion } from "./types.js";
import { v31 } from "./v31.js";

export const v32: SokoBotVersion = {
  ...v31,
  id: "v32",
  name: "v32 · Posting instructions",
  createdAt: "2026-10-27",
  summary:
    "v31 that reads a Project's posting instructions with get_posting_instructions and follows them (tone, hashtags, calls to action, per-platform sections) before drafting or rewriting a Social post.",
  releaseNote:
    "When you write posting instructions for a Project in Social, I read them before drafting any post and follow them: your tone, the hashtags and calls to action you want, and the rules for each platform.",
  skills: v31.skills.map((skill) =>
    skill === "social" ? "social-posting-instructions" : skill,
  ),
};
