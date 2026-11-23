import { cmoV13 } from "./cmo-v13.js";
import { CMO_PART_PATCH_STRATEGY_SKILL } from "./cmo-v13-skills.js";
import { CMO_CHANNEL_FIT_STRATEGY_SKILL } from "./cmo-v14-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v13 with each network at its own rate (owner, 2026-11-21): several X
 * posts a day, LinkedIn at most one, more pictures, TikToks, Reels and
 * YouTube Shorts every day, the funnel where the posts are, and every format
 * by the platform's own name.
 */
export const cmoV14: SokoBotVersion = {
  ...cmoV13,
  id: "cmo-v14",
  name: "cmo-v14 · Cuso, each network at its own rate",
  createdAt: "2026-11-21",
  summary:
    "Cuso on cmo-v13 who plans each network at its own rate: four X posts a day, at most one on LinkedIn, more pictures, and TikToks, Reels and YouTube Shorts every day; the funnel follows where the posts are and every format has its platform's name.",
  whatsNew: [
    "More posts on the networks that suit your business, at the pace each one likes.",
    "Short videos, each made once and shared on TikTok, Instagram Reels and YouTube Shorts.",
  ],
  releaseNote:
    "Your strategy now fits each network: several posts a day on X, at most one a day on LinkedIn, more pictures, and TikToks, Reels and YouTube Shorts every day. It shows the most your plan can make; a smaller plan makes less of the same month.",
  skills: cmoV13.skills.map((skill) =>
    skill === CMO_PART_PATCH_STRATEGY_SKILL
      ? CMO_CHANNEL_FIT_STRATEGY_SKILL
      : skill,
  ),
};
