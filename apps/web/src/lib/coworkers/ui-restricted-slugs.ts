export const UI_RESTRICTED_COWORKER_SLUGS = ["hermes"] as const;

const UI_RESTRICTED_COWORKER_SLUG_SET = new Set<string>(
  UI_RESTRICTED_COWORKER_SLUGS.map(normalizeCoworkerSlug),
);

export function normalizeCoworkerSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

export function isUiRestrictedCoworkerSlug(
  slug: string | null | undefined,
): boolean {
  if (!slug) return false;
  return UI_RESTRICTED_COWORKER_SLUG_SET.has(normalizeCoworkerSlug(slug));
}

export function filterCoworkersForUiListing<T extends { slug?: string | null }>(
  coworkers: readonly T[],
): T[] {
  return coworkers.filter(
    (coworker) => !isUiRestrictedCoworkerSlug(coworker.slug),
  );
}
