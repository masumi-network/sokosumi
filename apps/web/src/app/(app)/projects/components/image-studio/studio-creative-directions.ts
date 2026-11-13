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

const AD_VARIATION_SUFFIXES = [
  "Frame the product from the front. If the brief calls for copy, lead with its main benefit.",
  "Place the product off-center with open space. If the brief calls for copy, lead with the customer's need.",
  "Use a close-up that highlights a recognizable detail. If the brief calls for copy, lead with a product feature.",
  "Use a strong diagonal composition. If the brief calls for copy, lead with an action.",
  "Frame the product in a wide scene. If the brief calls for copy, lead with an occasion for using it.",
  "Use a tight, balanced composition. If the brief calls for copy, lead with an approved selling point.",
  "Arrange the layout in two clear zones. If the brief calls for copy, explain what the product does.",
  "Frame the product with shapes drawn from its surroundings. If the brief calls for copy, lead with the experience of using it.",
  "Use an overhead or near-overhead view. If the brief calls for copy, lead with a practical use.",
  "Frame the product at an angle with depth. If the brief calls for copy, lead with the outcome described in the brief.",
  "Put the product in the lower half of the composition. If the brief calls for copy, ask a question relevant to the audience.",
  "Use a bold crop with the product still identifiable. If the brief calls for copy, put the product name first.",
].map(
  (angle) =>
    `\n\nAd variation: ${angle} Follow the brief and creative direction first, keep any exact wording, and use only supplied claims.`,
);

export function studioAdVariationIndex(prompt: string): number | undefined {
  const index = AD_VARIATION_SUFFIXES.findIndex((suffix) =>
    prompt.includes(suffix),
  );
  return index === -1 ? undefined : index;
}

export function studioAdCopyPrompts(
  prompt: string,
  copies: number,
  maxLength: number,
): string[] {
  if (copies < 2) return copies === 1 ? [prompt] : [];
  const previous = AD_VARIATION_SUFFIXES.find((suffix) =>
    prompt.includes(suffix),
  );
  const brief = previous ? prompt.replace(previous, "") : prompt;
  const suffixes = AD_VARIATION_SUFFIXES.slice(0, copies);
  if (
    suffixes.length === copies &&
    suffixes.every((suffix) => brief.length + suffix.length <= maxLength)
  ) {
    return suffixes.map((suffix) => brief + suffix);
  }
  return Array.from({ length: copies }, () => prompt);
}
