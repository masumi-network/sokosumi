export const STUDIO_CREATIVE_DIRECTIONS = [
  {
    id: "spotlight",
    guidance:
      "Make the product the visual focal point. Use a clear silhouette, deliberate lighting, and a simple composition that keeps the product and its packaging recognizable.",
  },
  {
    id: "lifestyle",
    guidance:
      "Show the product in a believable real-world setting or in use. Choose a scene that shows the audience where it fits into their life.",
  },
  {
    id: "editorial",
    guidance:
      "Use an editorial composition with intentional art direction, a distinctive crop, and a clear hierarchy for any approved ad copy.",
  },
  {
    id: "explainer",
    guidance:
      "Illustrate how the product works or why it is useful. Use simple visual cues or concise callouts grounded in the supplied product details.",
  },
] as const;

export type StudioCreativeDirection =
  (typeof STUDIO_CREATIVE_DIRECTIONS)[number]["id"];
