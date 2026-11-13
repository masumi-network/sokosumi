/** Which queries the Search Console table lists. */
export const SEO_BRAND_VIEWS = ["all", "branded", "non_branded"] as const;
export type SeoBrandView = (typeof SEO_BRAND_VIEWS)[number];

/** Case, compatibility forms and accents do not matter: "CAFÉ" and "cafe" are one word. */
function brandWords(text: string): string[] {
  return (
    text
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/**
 * A query is branded when one brand term stands in it as whole words, in order.
 * Part of a word does not count: "art" does not make "party" branded. A
 * spelling such as "acmeshop" is its own term for the owner to add.
 */
export function seoIsBrandedQuery(query: string, terms: string[]): boolean {
  const words = brandWords(query);
  return terms.some((term) => {
    const needle = brandWords(term);
    if (!needle.length) return false;
    for (let start = 0; start + needle.length <= words.length; start++)
      if (needle.every((word, index) => words[start + index] === word))
        return true;
    return false;
  });
}

/** One brand term per line or between commas; blanks are dropped. */
export function seoParseBrandTerms(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

interface BrandRow {
  query: string;
  clicks: number;
  impressions: number;
}

/** The listed rows of one view. Without brand terms every view lists all rows. */
export function seoBrandRows<T extends BrandRow>(
  rows: T[],
  terms: string[],
  view: SeoBrandView,
): T[] {
  if (view === "all" || !terms.length) return rows;
  return rows.filter(
    (row) => seoIsBrandedQuery(row.query, terms) === (view === "branded"),
  );
}

/** Clicks and impressions of the listed branded and non-branded queries. Hidden queries are in neither. */
export function seoBrandTotals(rows: BrandRow[], terms: string[]) {
  const totals = {
    branded: { clicks: 0, impressions: 0 },
    nonBranded: { clicks: 0, impressions: 0 },
  };
  for (const row of rows) {
    const side = seoIsBrandedQuery(row.query, terms)
      ? totals.branded
      : totals.nonBranded;
    side.clicks += row.clicks;
    side.impressions += row.impressions;
  }
  return totals;
}
