import type {
  AdMarketProfile,
  GoogleLanguage,
  GoogleLocation,
} from "@sokosumi/core-client";

/**
 * The longest place name Core's location search takes: the `q` limit of
 * `searchGoogleLocationsQuerySchema` (apps/core/src/schemas/project-ad-account.schema.ts).
 */
export const GOOGLE_LOCATION_QUERY_MAX_LENGTH = 80;

/** A location or language as the form holds it: Google's id and a name to show. */
export interface GoogleTarget {
  id: string;
  name: string;
  /** The full name, for a hint and for assistive tech: "Paris, Texas, United States". */
  detail?: string;
}

/** What the create page hands the form to pick from and start with. */
export interface GoogleTargeting {
  /** Every language Google can target; null when it could not be loaded. */
  languageOptions: GoogleTarget[] | null;
  /** What the project's Market profile suggests; empty without one. */
  defaultLocations: GoogleTarget[];
  defaultLanguages: GoogleTarget[];
}

/** A Google location as a chip: the full name is spelled out for reading. */
export function toGoogleTarget({
  id,
  name,
  canonicalName,
}: GoogleLocation): GoogleTarget {
  return { id, name, detail: canonicalName.replaceAll(",", ", ") };
}

export function hasTarget(selected: readonly GoogleTarget[], id: string) {
  return selected.some((target) => target.id === id);
}

/**
 * What the Google form starts with: every language to pick from, and the
 * Market profile's country (already looked up as `locations`) and language,
 * matched by Core's code, which is Google's. A part that did not load is empty.
 */
export function toGoogleTargeting({
  profile,
  languages,
  locations,
}: {
  profile: Pick<AdMarketProfile, "languageCode"> | null;
  languages: GoogleLanguage[] | null;
  locations: GoogleLocation[];
}): GoogleTargeting {
  const language = languages?.find(
    ({ code }) => code === profile?.languageCode,
  );
  return {
    languageOptions: languages?.map(({ id, name }) => ({ id, name })) ?? null,
    defaultLocations: locations.map(toGoogleTarget),
    defaultLanguages: language
      ? [{ id: language.id, name: language.name }]
      : [],
  };
}
