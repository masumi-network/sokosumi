import { SOKO_BOT_TOOL_DESCRIPTIONS } from "../tool-contracts.js";
import type { SokoBotSkill } from "./skills.js";

const STYLE_TOOL = "find_style_references";

/** How cmo-v3 gives a piece's picture the look of an old print (owner, 2026-11-17). */
const PICTURE_STYLES = `

## Picture styles
A piece with a picture can take the look of an old print: call find_style_references with what the piece is about and the look you want, and pick one whose kind and era suit the brand and the message (infographics for data and how-to, posters for events and announcements, ads and labels for products and offers). Put its id in styleReferenceId and, when the picture should carry words, at most six of them in headline, taken from the piece's hook. Decide per piece: use a style where a striking, on-brand image helps more than a product shot; keep brandPictures for pieces that must show the real product or screens. Never use one reference twice in a month, and vary eras and kinds. Core adds the brand's logo, colours and DESIGN.md and remakes a weak picture.`;

/**
 * cmo-v3's production skill: cmo-production, plus picture styles once the
 * reference library's tool exists (branch cmo-reference-ads); until then it
 * is cmo-production word for word, so it never names a tool Cuso lacks.
 */
export function productionWithStyles(base: SokoBotSkill): SokoBotSkill {
  return {
    ...base,
    id: "cmo-production-styles",
    content:
      STYLE_TOOL in SOKO_BOT_TOOL_DESCRIPTIONS
        ? `${base.content.trimEnd()}${PICTURE_STYLES}\n`
        : base.content,
  };
}
