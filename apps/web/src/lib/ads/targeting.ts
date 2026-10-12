/** The longest place name Core's location search takes. */
export const GOOGLE_LOCATION_QUERY_MAX_LENGTH = 80;

/** A location or language as the form holds it: Google's id and a name to show. */
export interface GoogleTarget {
  id: string;
  name: string;
  /** The longer name, for a hint: "Paris,Texas,United States". */
  detail?: string;
}

/** What the create page hands the form to pick from and start with. */
export interface GoogleTargeting {
  /** Every language Google can target; null when it could not be loaded. */
  languages: GoogleTarget[] | null;
  /** What the project's Market profile suggests; empty without one. */
  defaultLocations: GoogleTarget[];
  defaultLanguages: GoogleTarget[];
}

/** Codes that name one language and differ between ISO and Google. */
const SAME_LANGUAGE = [
  ["he", "iw"],
  ["nb", "no"],
  ["fil", "tl"],
];

/** `zh_CN` and `zh-cn` are one code; case does not matter. */
const normalize = (code: string) => code.toLowerCase().replaceAll("_", "-");

/**
 * Google's language for a Market (ISO 639) language code, or undefined when
 * Google has none. Matching ignores case and `-` versus `_`, and knows the few
 * codes the two sides spell differently.
 */
export function matchGoogleLanguage<T extends { code: string }>(
  code: string,
  languages: readonly T[],
): T | undefined {
  const wanted = normalize(code);
  const accepted = new Set(
    SAME_LANGUAGE.find((group) => group.includes(wanted)) ?? [wanted],
  );
  return languages.find(({ code: candidate }) =>
    accepted.has(normalize(candidate)),
  );
}
