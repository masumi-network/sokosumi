import { CMO_SCENE_PRODUCTION_SKILL } from "./cmo-v9-skills.js";
import { cmoV10 } from "./cmo-v10.js";
import { CMO_PICKED_PRODUCTION_SKILL } from "./cmo-v11-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v10 whose pictures take only a print's layout and are drawn in the
 * brand's own look (owner, 2026-11-21: "take the layout and adapt the
 * style"). Core makes five alternatives of every picture, checks each, and
 * picks the best side by side; the owner sees them all under Settings,
 * Pictures. The kind of picture varies across the month.
 */
export const cmoV11: SokoBotVersion = {
  ...cmoV10,
  id: "cmo-v11",
  name: "cmo-v11 · Cuso, pictures on a print's layout in your look",
  createdAt: "2026-11-21",
  summary:
    "Cuso on cmo-v10 whose pictures borrow only an old print's layout and are drawn in the brand's own look, in a picture kind that varies across the month; Core makes five alternatives of each and picks the best.",
  releaseNote:
    "Your pictures now borrow the layout of a classic poster or cover and are drawn in your own brand's look. Cuso makes five versions of each and keeps the best; you can see them all under Settings, Pictures.",
  skills: cmoV10.skills.map((skill) =>
    skill === CMO_SCENE_PRODUCTION_SKILL ? CMO_PICKED_PRODUCTION_SKILL : skill,
  ),
};
