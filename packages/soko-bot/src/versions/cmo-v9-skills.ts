import type { SokoBotSkill } from "./skills.js";

/** cmo-v9's production skill: a styled picture's visual is one concrete scene. */
export const CMO_SCENE_PRODUCTION_SKILL = "cmo-production-scenes";

function revised(
  base: { id: string; content: string },
  id: string,
  swaps: readonly (readonly [string, string])[],
): string {
  return swaps.reduce((text, [before, after]) => {
    if (!text.includes(before))
      throw new Error(`${id}: "${before.slice(0, 60)}" is not in ${base.id}`);
    return text.replace(before, after);
  }, base.content);
}

/**
 * NMKR's styled pictures (2026-11-20): 31 of 40 visuals named their own
 * palette ("cream paper, dark ink, one green accent"), 39 carried "no …"
 * lists and 19 were steps or flows, and every reference came out as the same
 * green-on-cream icon diagram. The 16 Nov test Patrick picked gave the model
 * one concrete scene and let the print set the look.
 */
const SCENE_RULE =
  'A styled picture\'s visual is one concrete scene: who or what, doing what, where, often a physical metaphor for the piece\'s point ("a crane hook lifting a glowing token over a factory city", not "three steps of a mint shown as icons"). Never its medium, era, colours, paper or texture, and no "no …" or "avoid …" list: the look comes from the print, and Core refuses a styled visual that names one.';

const STYLE_IN_VISUAL_BEFORE =
  "the real product, screen, place or result from the Brand Brain, the style (a photo, a flat graphic, a screen close-up), the framing (close-up, from above, the whole room), the setting and the light.";
const STYLE_IN_VISUAL_AFTER =
  "the real product, screen, place or result from the Brand Brain, the framing (close-up, from above, the whole room), the setting and the light; the style (a photo, a flat graphic, a screen close-up) only for a picture that takes no old print's style.";

const LOGO_BEFORE =
  "Core adds the brand's logo, colours and DESIGN.md and remakes a weak picture.";
const LOGO_AFTER =
  "Core has the print draw in the brand's logo, prints it in the brand's colours, letters the headline with the site's address, and remakes a weak picture.";

/** `base` is cmo-v8's varied production skill. */
export function sceneProduction(base: SokoBotSkill): SokoBotSkill {
  return {
    ...base,
    id: CMO_SCENE_PRODUCTION_SKILL,
    description: `${base.description} A styled picture's visual is one concrete scene.`,
    content: revised(base, CMO_SCENE_PRODUCTION_SKILL, [
      [STYLE_IN_VISUAL_BEFORE, STYLE_IN_VISUAL_AFTER],
      [
        "Put its id in styleReferenceId.",
        `Put its id in styleReferenceId. ${SCENE_RULE}`,
      ],
      [LOGO_BEFORE, LOGO_AFTER],
      [
        "generate_image with what the picture shows as prompt,",
        "generate_image with the scene the picture shows as prompt (one concrete scene, as above),",
      ],
    ]),
  };
}

/** `guide` is the brief Core's month writer works from for cmo-v8. */
export function scenePieceWritingGuide(guide: string): string {
  return revised({ id: "writer-v8", content: guide }, "writer-v9", [
    [
      "what the picture shows for this piece's message (the real product, screen, place or result from the Brand Brain), the style, the framing, the setting and the light.",
      `what the picture shows for this piece's message (the real product, screen, place or result from the Brand Brain), the framing, the setting and the light; the style only for a picture without styleLook. ${SCENE_RULE} The look goes in styleLook.`,
    ],
  ]);
}
