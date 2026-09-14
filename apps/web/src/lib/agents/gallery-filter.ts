export const GALLERY_AGENT_KINDS = ["all", "cardano", "x402"] as const;

export type GalleryAgentKindFilter = (typeof GALLERY_AGENT_KINDS)[number];

export interface GalleryFilterState {
  query: string;
  categories: string[];
  kind: GalleryAgentKindFilter;
}
