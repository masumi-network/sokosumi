export const SEO_DATA_VISIBILITY = {
  PRIVATE: "PRIVATE",
  SHARED: "SHARED",
} as const;

export const SEO_SHARING_SCOPES = ["organization", "personal"] as const;

export function seoSharingFor(actor: { organizationId: string | null }) {
  return actor.organizationId ? SEO_SHARING_SCOPES[0] : SEO_SHARING_SCOPES[1];
}

export function seoVisibilityFor(actor: { organizationId: string | null }) {
  return actor.organizationId
    ? SEO_DATA_VISIBILITY.SHARED
    : SEO_DATA_VISIBILITY.PRIVATE;
}
