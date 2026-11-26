import type { SokoBotSkill } from "./skills.js";

/** cmo-v11's production skill: a picture borrows a print's layout and is drawn in the brand's look. */
export const CMO_PICKED_PRODUCTION_SKILL = "cmo-production-picked";

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
 * Patrick (2026-11-21): "we're trying to recreate the look too much instead
 * of just taking the layout and then adapting the style". In the layout
 * experiment the reference's composition, sent as a block map and drawn in
 * the brand's own look, kept the poster's structure without its paper and
 * period lettering; the brand's look made every picture alike, so the kind
 * of picture now varies across the month.
 */
const LOOK_BEFORE =
  "Every piece with a picture takes the look of an old print, whatever it shows: call find_style_references with what the piece is about and the look you want, and pick one whose kind and era suit the brand and the message";
const LOOK_AFTER =
  'Every piece with a picture borrows the layout of an old print and is drawn in the brand\'s own look: call find_style_references with what the piece is about and the composition you want ("a big headline on top, one hero figure pointing at the viewer"), and pick one whose composition suits the message. Give it a pictureKind, one of flat illustration, bold graphic, photographic scene or isometric illustration: vary it across the month, so neighbouring pieces on one network take different kinds,';
const PRINT_LOOK_BEFORE =
  'Never its medium, era, colours, paper or texture, and no "no …" or "avoid …" list: the look comes from the print, and Core refuses a styled visual that names one.';
const PRINT_LOOK_AFTER =
  'Never its medium, era, colours, paper or texture, and no "no …" or "avoid …" list: the look comes from the brand and the pictureKind, and Core refuses a styled visual that names one.';
const MAKING_BEFORE =
  "Core has the print draw in the brand's logo, prints it in the brand's colours, letters the headline with the site's address, and remakes a weak picture.";
const MAKING_AFTER =
  "Core makes five alternatives in the brand's look on the print's layout, with the brand's logo and the headline with the site's address, checks each, picks the best one side by side, and makes it again on a stronger model when none passes. The owner sees every alternative under Settings, Pictures.";

/** `base` is cmo-v9's scene production skill. */
export function pickedProduction(base: SokoBotSkill): SokoBotSkill {
  return {
    ...base,
    id: CMO_PICKED_PRODUCTION_SKILL,
    description: `${base.description} A picture borrows only a print's layout, in the brand's look and a varied pictureKind; Core picks the best of five.`,
    content: revised(base, CMO_PICKED_PRODUCTION_SKILL, [
      [LOOK_BEFORE, LOOK_AFTER],
      [PRINT_LOOK_BEFORE, PRINT_LOOK_AFTER],
      [MAKING_BEFORE, MAKING_AFTER],
      [
        "Never use one reference twice in a month, and vary eras and kinds.",
        "Never use one reference twice in a month.",
      ],
      [
        "the reference's id as styleReferenceId, the few words it carries as headline",
        "the reference's id as styleReferenceId, a pictureKind, the few words it carries as headline",
      ],
    ]),
  };
}

/** `guide` is the brief Core's month writer works from for cmo-v9. */
export function pickedPieceWritingGuide(guide: string): string {
  return revised({ id: "writer-v9", content: guide }, "writer-v11", [
    [
      "the look comes from the print, and Core refuses a styled visual that names one. The look goes in styleLook.",
      "the look comes from the brand and the pictureKind, and Core refuses a styled visual that names one.",
    ],
    [
      '- styleLook, where pictures take an old print\'s style: what the piece is about and the look that suits it ("three steps of a mint, Isotype pictograms", "a launch, bold Art Deco travel poster"). Core picks a different print for every piece from it; vary kinds and eras across the month.',
      '- styleLook, where pictures take an old print\'s layout: what the piece is about and the composition that suits it ("a launch, one big headline on top and a single hero figure", "three options, three equal panels side by side"). Core picks a different print for every piece from it and borrows only its layout; the picture is drawn in the brand\'s own look.\n- pictureKind, with styleLook: flat illustration, bold graphic, photographic scene or isometric illustration. Vary it across the month: neighbouring pieces on one network never share a kind.',
    ],
  ]);
}
