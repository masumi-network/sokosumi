import type { StudioSettings } from "./types";

// These editable prompts are model input. Only their labels are localized.
export const STUDIO_TEMPLATES = [
  {
    id: "story-ad",
    aspectRatio: "9:16",
    prompt:
      "Create a vertical ad for [product, offer or event] aimed at [audience]. Use dramatic directional light and a single focal point. Keep the subject and any approved headline or call to action clear of the top and bottom interface areas. Use only the offer details I provide.",
  },
  {
    id: "social-post",
    aspectRatio: "4:5",
    prompt:
      "Create a lifestyle feed ad for [product] aimed at [audience]. Show the product being used in [setting] with warm natural daylight. Make [benefit] clear through the scene. Leave a quiet area for the headline and use only approved claims.",
  },
  {
    id: "product-announcement",
    aspectRatio: "16:9",
    prompt:
      "Create a launch ad for [product]. Show the product on the right with clean studio lighting and room on the left for [headline]. Keep the reference packaging and logo intact. Use only the launch details and claims I provide.",
  },
  {
    id: "ad",
    aspectRatio: "1:1",
    prompt:
      "Create a square product spotlight ad for [product]. Centre the product on a simple branded backdrop with crisp directional lighting. Keep its packaging and logo intact. Leave room for [call to action] and use only approved claims.",
  },
  {
    id: "banner",
    aspectRatio: "16:9",
    prompt:
      "Create a wide display ad for [product or offer] aimed at [audience]. Keep the subject on the right and the left half clear for a short headline and [call to action]. Use the brand palette and include only approved offer details.",
  },
] as const satisfies readonly {
  id: string;
  aspectRatio: NonNullable<StudioSettings["aspectRatio"]>;
  prompt: string;
}[];

export type StudioTemplate = (typeof STUDIO_TEMPLATES)[number];
export type StudioTemplateId = StudioTemplate["id"];
