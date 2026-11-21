import { CMO_CLAIMS_STRATEGY_SKILL } from "./cmo-v8-skills.js";
import { cmoV11 } from "./cmo-v11.js";
import { CMO_SEO_REPORTS_SKILL } from "./cmo-v12-skills.js";
import { CMO_PART_PATCH_STRATEGY_SKILL } from "./cmo-v13-skills.js";
import type { SokoBotVersion } from "./types.js";

const SWAPS: Readonly<Record<string, string>> = {
  "cmo-seo": CMO_SEO_REPORTS_SKILL,
  [CMO_CLAIMS_STRATEGY_SKILL]: CMO_PART_PATCH_STRATEGY_SKILL,
};

/**
 * One Cuso with the 2026-11-21 work together (owner): cmo-v10's stronger
 * model for hard work, cmo-v11's pictures on a print's layout picked from
 * five alternatives, cmo-v12's weekly SEO report, and an owner's change to
 * part of the plan saved as a part patch, never the whole calendar.
 */
export const cmoV13: SokoBotVersion = {
  ...cmoV11,
  id: "cmo-v13",
  name: "cmo-v13 · Cuso, picked pictures and weekly SEO reports",
  createdAt: "2026-11-21",
  summary:
    "Cuso on cmo-v11 (stronger model for hard work, pictures on a print's layout picked from five alternatives) who also reports on SEO after each weekly audit with before and after page changes and articles on request, and saves an owner's change to part of the plan as a part patch.",
  releaseNote:
    "Your pictures now borrow the layout of a classic poster or cover, drawn in your own look; I make five versions of each and keep the best. Every week after your site audit I tell you in the chat what changed on Google, the changes worth most with their before and after, and new article ideas. Ask me for articles any time and I write them, ready to copy.",
  skills: cmoV11.skills.map((skill) => SWAPS[skill] ?? skill),
};
