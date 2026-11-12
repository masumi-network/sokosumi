import type { AvatarDefinition } from "open-bot-avatar";

/**
 * Flat Cuso's body as an open-bot-avatar definition. open-bot-avatar fills
 * one silhouette, so this is the "Ink solid" variant: the body outline offset
 * by half the line weight and scaled into the library's 0 to 100 box.
 * Regenerate the path if `BODY` in `flat-cuso.tsx` changes.
 */
export const CUSO_POINTER: AvatarDefinition = {
  version: 1,
  id: "cuso-flat",
  name: "Cuso",
  body: {
    path: "M24.7 8.51A1.68 1.68 0 0 0 21.82 9.68L21.82 83.91A1.68 1.68 0 0 0 24.63 85.15L38.11 73.02L45.31 90.95A1.68 1.68 0 0 0 47.46 91.89L63.03 86.09A1.68 1.68 0 0 0 64 83.88L56.55 65.73L76.5 65.73A1.68 1.68 0 0 0 77.7 62.88Z",
  },
  eyes: { x: 40.76, y: 49.08, spacing: 9.77, scale: 0.9 },
};
