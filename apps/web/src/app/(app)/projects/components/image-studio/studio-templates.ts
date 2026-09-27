import type { StudioSettings } from "./types";

/**
 * The briefs the studio offers as a starting point.
 *
 * Each one fills the composer and sets the frame it was written for, and
 * nothing else: it does not submit, and the text stays editable, because the
 * point of a template is to be rewritten.
 *
 * **The prompt bodies are English in every locale, deliberately.** They are
 * model input, not copy: fal's text-to-image endpoints are tuned on English,
 * and a German or Spanish brief measurably changes what comes back — so
 * translating them would quietly make the same button do a different thing per
 * locale. Only `label` is localized, under `App.Studio.Templates.<id>`.
 *
 * Each body is written the way these models read best: one subject, one light
 * description, one composition instruction, and — where the image is meant to
 * carry words later — an explicit empty zone plus "no lettering", because
 * every one of these models will otherwise invent misspelt text.
 *
 * Not a plain module by accident. `buildStudioLabels` reads this list from a
 * Server Component, and a value imported across the client boundary resolves
 * to a client reference rather than to the value, so this file must stay free
 * of `"use client"`.
 */
export interface StudioTemplate {
  id: StudioTemplateId;
  /** The frame this brief was composed for. */
  aspectRatio: NonNullable<StudioSettings["aspectRatio"]>;
  /** English in every locale; see above. */
  prompt: string;
}

export type StudioTemplateId = (typeof STUDIO_TEMPLATE_IDS)[number];

export const STUDIO_TEMPLATE_IDS = [
  "poster",
  "headshot",
  "product-announcement",
  "flyer",
  "infographic",
  "illustration",
  "icon",
  "ad",
  "social-post",
  "banner",
  "logo-mark",
  "background",
  "thumbnail",
  "mockup",
] as const;

export const STUDIO_TEMPLATES: readonly StudioTemplate[] = [
  {
    id: "poster",
    aspectRatio: "2:3",
    prompt:
      "A bold event poster: one dominant subject centred in the upper two thirds, dramatic directional light, deep shadows, a wide band of flat colour across the lower third left completely empty for a headline, high contrast, print-quality detail, no lettering.",
  },
  {
    id: "headshot",
    aspectRatio: "4:5",
    // "grey to white" is spaced, not hyphenated, and deliberately so: hyphenated
    // it ends in a substring the repo's colour-token guard reads as a raw
    // Tailwind gradient class and fails the build on. Same words, same brief.
    prompt:
      "A professional studio headshot of one person from the chest up, facing the camera, soft key light with gentle fill, shallow depth of field, seamless grey to white gradient backdrop, natural skin texture, calm confident expression, 85mm portrait lens look.",
  },
  {
    id: "product-announcement",
    aspectRatio: "16:9",
    prompt:
      "A clean product announcement hero: the product centre-right on a smooth seamless background in a single saturated colour, soft reflection beneath it, crisp edge light along the silhouette, the left third left empty for a headline, studio product photography, no lettering.",
  },
  {
    id: "flyer",
    aspectRatio: "3:4",
    prompt:
      "A single-page promotional flyer layout: a strong photographic band across the top third, flat colour blocks below arranged as clear empty zones for a headline, three short paragraphs and a footer, generous margins, modern editorial design, no lettering.",
  },
  {
    id: "infographic",
    aspectRatio: "4:5",
    prompt:
      "A clean vector infographic layout: three stacked sections, a simple flat icon at the left of each and an empty label area at the right, thin connecting lines, a restrained three-colour palette on an off-white background, plenty of whitespace, no lettering.",
  },
  {
    id: "illustration",
    aspectRatio: "16:9",
    prompt:
      "A warm flat-vector editorial illustration of a small team collaborating around a laptop, simplified shapes, two accent colours over a muted base, subtle paper grain, soft geometric background shapes, balanced composition with clear negative space.",
  },
  {
    id: "icon",
    aspectRatio: "1:1",
    prompt:
      "A single app icon on a plain background: one simple centred symbol, thick even strokes, rounded corners, flat two-tone colour with a soft gradient, generous padding, legible at small sizes, no lettering, no drop shadow.",
  },
  {
    id: "ad",
    aspectRatio: "1:1",
    prompt:
      "A scroll-stopping square social ad: the subject large and centred, saturated single-colour backdrop, hard directional light casting one crisp shadow, a clear empty band across the bottom for a call to action, punchy contemporary commercial photography, no lettering.",
  },
  {
    id: "social-post",
    aspectRatio: "4:5",
    prompt:
      "A candid lifestyle social post image: the subject slightly off-centre in a bright natural setting, warm daylight, shallow depth of field, airy colour grade, comfortable empty space at the top for a caption overlay.",
  },
  {
    id: "banner",
    aspectRatio: "16:9",
    prompt:
      "A wide banner image: an abstract conceptual scene built from soft gradients and layered translucent shapes, muted brand-neutral palette, detail concentrated on the right so the left half stays quiet for a title, gentle depth, no lettering.",
  },
  {
    id: "logo-mark",
    aspectRatio: "1:1",
    prompt:
      "A minimal abstract logo mark: one geometric symbol built from two or three simple forms, perfectly balanced, solid single colour on a plain light background, even stroke weight, vector-clean edges, no lettering, no gradients.",
  },
  {
    id: "background",
    aspectRatio: "16:9",
    prompt:
      "A seamless abstract background: soft overlapping organic shapes in a close-toned palette, subtle film grain, even lighting with no focal point, calm and unobtrusive so text can sit anywhere on top.",
  },
  {
    id: "thumbnail",
    aspectRatio: "16:9",
    prompt:
      "A high-contrast video thumbnail: one expressive subject large in the right half, bright rim light against a darkened simplified background, saturated complementary colours, the left half kept clear for a short headline, no lettering.",
  },
  {
    id: "mockup",
    aspectRatio: "4:3",
    prompt:
      "A device mockup scene: a laptop and a phone angled on a light desk surface, soft daylight from the left, blank bright screens ready for a screenshot, minimal props, shallow depth of field, clean commercial product photography.",
  },
];
