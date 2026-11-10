export const AD_PLACEMENTS = [
  { ratio: "1:1", label: "squareFeed" },
  { ratio: "4:5", label: "portraitFeed" },
  { ratio: "9:16", label: "stories" },
  { ratio: "16:9", label: "landscapeFeed" },
] as const;
export type PlacementRatio = (typeof AD_PLACEMENTS)[number]["ratio"];
