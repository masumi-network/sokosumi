import { cmoV8 } from "./cmo-v8.js";
import { CMO_VARIED_PRODUCTION_SKILL } from "./cmo-v8-skills.js";
import { CMO_SCENE_PRODUCTION_SKILL } from "./cmo-v9-skills.js";
import type { SokoBotVersion } from "./types.js";

/**
 * cmo-v8 whose styled pictures look like the prints they are made from
 * (owner, 2026-11-21). The 16 Nov reference test gave the model one concrete
 * scene and let the print set the look; cmo-v8's visuals named their own
 * palette and steps, and every print came out as one green-on-cream icon
 * diagram. A styled visual is now the scene alone, and Core refuses one that
 * names a medium, era, colour or "no …" list.
 */
export const cmoV9: SokoBotVersion = {
  ...cmoV8,
  id: "cmo-v9",
  name: "cmo-v9 · Cuso, pictures that look like the print",
  createdAt: "2026-11-21",
  summary:
    "Cuso on cmo-v8 whose styled pictures describe one concrete scene and leave the look to the old print they are made from, with the brand's logo drawn into the design.",
  releaseNote:
    "Your pictures now look like the old prints they are made from: a real scene in the print's own technique and lettering, with your logo and site address drawn into the design.",
  skills: cmoV8.skills.map((skill) =>
    skill === CMO_VARIED_PRODUCTION_SKILL ? CMO_SCENE_PRODUCTION_SKILL : skill,
  ),
};
