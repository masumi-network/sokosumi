export const GALLERY_AGENT_KINDS = ["all", "cardano", "x402"] as const;

export type GalleryAgentKindFilter = (typeof GALLERY_AGENT_KINDS)[number];

/** Which half of the Agents page the one search shows. */
export const GALLERY_SCOPES = ["all", "coworkers", "agents"] as const;

export type GalleryScope = (typeof GALLERY_SCOPES)[number];

export interface GalleryFilterState {
  query: string;
  categories: string[];
  kind: GalleryAgentKindFilter;
}
