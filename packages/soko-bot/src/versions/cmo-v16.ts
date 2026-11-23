import { cmoV15 } from "./cmo-v15.js";
import { CMO_PLAIN_WORDS_STRATEGY_SKILL } from "./cmo-v15-skills.js";
import { CMO_SHORTS_STRATEGY_SKILL } from "./cmo-v16-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v15 whose short videos are real shorts (owner, 2026-11-23): a script,
 * a hook line and one of four kinds per short, cut by Core from the brand's
 * pictures and website, instead of one picture moving for five seconds.
 */
export const cmoV16: SokoBotVersion = {
  ...cmoV15,
  id: "cmo-v16",
  name: "cmo-v16 · Cuso, shorts with a voice",
  createdAt: "2026-11-23",
  summary:
    "Cuso on cmo-v15 whose TikToks, Reels and Shorts each get a script and a hook: a story with a voice, a website tour, a top 3 list or a photo slideshow, cut from the brand's pictures and its real website.",
  whatsNew: [
    "Your TikToks, Reels and Shorts now have a voice, captions and music.",
    "They show your real website and pictures, never made up screens.",
  ],
  releaseNote:
    "Your short videos now tell something: a story with a voice, a tour of your website, a top 3 list or a photo slideshow, with captions, music and your logo at the end.",
  skills: cmoV15.skills.map((skill) =>
    skill === CMO_PLAIN_WORDS_STRATEGY_SKILL
      ? CMO_SHORTS_STRATEGY_SKILL
      : skill,
  ),
};
