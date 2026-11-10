import type { StudioAdPlacementRatio } from "@sokosumi/core-client";

export const AD_PLACEMENTS = [
  { ratio: "1:1", label: "squareFeed" },
  { ratio: "4:5", label: "portraitFeed" },
  { ratio: "9:16", label: "stories" },
  { ratio: "16:9", label: "landscapeFeed" },
] as const satisfies readonly {
  ratio: StudioAdPlacementRatio;
  label: string;
}[];
export type PlacementRatio = StudioAdPlacementRatio;
