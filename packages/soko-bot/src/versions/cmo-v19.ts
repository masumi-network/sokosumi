import { cmoV15 } from "./cmo-v15.js";
import { CMO_SITE_PAGES_SKILL } from "./cmo-v19-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v15 who works from the whole site (owner, 2026-11-23: "document the
 * entire website, all subpages, and store them in the brand brain for the
 * agent to use"): an index of the pages in his context, each page's note
 * and screenshots on demand.
 */
export const cmoV19: SokoBotVersion = {
  ...cmoV15,
  id: "cmo-v19",
  name: "cmo-v19 · Cuso, every page of your site",
  createdAt: "2026-11-23",
  summary:
    "Cuso on cmo-v15 who works from every page of the business's site: a short index of the pages in his context, and each page's facts, words and screenshots read when a piece needs them.",
  whatsNew: [
    "Cuso now reads every page of your site and uses its facts, prices and screenshots in your posts.",
  ],
  releaseNote:
    "I now read every page of your site, not only the homepage, and use each page's facts, prices and screenshots when I write and make your posts.",
  skills: [...cmoV15.skills, CMO_SITE_PAGES_SKILL],
};
