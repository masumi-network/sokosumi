import { cmoV9 } from "./cmo-v9.js";
import { CMO_SEO_REPORTS_SKILL } from "./cmo-v12-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v9 that reports on SEO (owner, 2026-11-21): after each weekly audit
 * Cuso writes one short SEO message with the week's Search Console change,
 * the changes worth most as before and after, and article ideas; he picks
 * searches from Search Console when a small market has no measured volume,
 * and writes articles on request. cmo-v10 and cmo-v11 were taken by model
 * routing and picture work on their own branches.
 */
export const cmoV12: SokoBotVersion = {
  ...cmoV9,
  id: "cmo-v12",
  name: "cmo-v12 · Cuso, weekly SEO reports",
  createdAt: "2026-11-21",
  summary:
    "Cuso on cmo-v9 who reports on SEO after each weekly audit, shows page changes as before and after, and writes keyword-led articles on request.",
  releaseNote:
    "Every week after your site audit I tell you in the chat what changed on Google, the changes worth most with their before and after, and new article ideas. Ask me for articles any time and I write them, ready to copy.",
  skills: cmoV9.skills.map((skill) =>
    skill === "cmo-seo" ? CMO_SEO_REPORTS_SKILL : skill,
  ),
};
