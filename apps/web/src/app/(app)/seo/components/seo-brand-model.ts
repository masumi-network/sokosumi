/** Which queries the Search Console table lists. */
export const SEO_BRAND_VIEWS = ["all", "branded", "non_branded"] as const;
export type SeoBrandView = (typeof SEO_BRAND_VIEWS)[number];

/**
 * Scripts written without spaces between words, plus Hangul, where a particle joins
 * the word: "ソニーテレビ" holds "ソニー". Word bounds are not readable there, so a
 * term in these scripts matches as a substring, with spaces ignored.
 */
const SUBSTRING_SCRIPT_CLASS =
  "\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}\\p{scx=Hangul}\\p{scx=Thai}\\p{scx=Lao}\\p{scx=Khmer}\\p{scx=Myanmar}";
const SUBSTRING_SCRIPTS = new RegExp(`[${SUBSTRING_SCRIPT_CLASS}]`, "u");
/**
 * A change between such a script and any other text is a word bound: "iPhoneケース"
 * holds the word "iphone", and "华为P50价格" the word "p50".
 */
const INTO_SUBSTRING_SCRIPT = new RegExp(
  `([^\\s${SUBSTRING_SCRIPT_CLASS}])(?=[${SUBSTRING_SCRIPT_CLASS}])`,
  "gu",
);
const OUT_OF_SUBSTRING_SCRIPT = new RegExp(
  `([${SUBSTRING_SCRIPT_CLASS}])(?=[^\\s${SUBSTRING_SCRIPT_CLASS}])`,
  "gu",
);
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
/** Compatibility forms would turn "acme™" into "acmetm"; the signs are not part of a name. */
const TRADEMARK_SIGNS = /[\u2120\u2122]/gu;
/** Accents are dropped only on Latin and Greek letters, so "café" is "cafe". */
const LATIN_GREEK_MARKS = /([\p{Script=Latin}\p{Script=Greek}])\p{Mn}+/gu;
/** Cyrillic keeps "й" apart from "и"; only "ё" reads as "е". */
const CYRILLIC_DIAERESIS = /(\p{Script=Cyrillic})\u0308/gu;
/**
 * A word keeps its marks (Indic vowel signs tell "हिंदी" from "हिंदू") and the signs
 * that make a name distinct: "c++", "c#" and "at&t" are not "c" or "at".
 */
const WORD = /[\p{L}\p{M}\p{N}+#&]+/gu;
const LEADING_JOINERS = /^[+#&]+/;

/** Case, compatibility forms and Latin or Greek accents do not matter: "CAFÉ" and "cafe" are one word. */
function brandText(text: string): string {
  return text
    .replace(TRADEMARK_SIGNS, " ")
    .normalize("NFKD")
    .replace(LATIN_GREEK_MARKS, "$1")
    .replace(CYRILLIC_DIAERESIS, "$1")
    .normalize("NFC")
    .toLocaleLowerCase();
}

/** Most queries hold no such script; they skip the two scans. */
function splitScripts(text: string): string {
  return SUBSTRING_SCRIPTS.test(text)
    ? text
        .replace(INTO_SUBSTRING_SCRIPT, "$1 ")
        .replace(OUT_OF_SUBSTRING_SCRIPT, "$1 ")
    : text;
}

function brandWords(text: string): string[] {
  return (splitScripts(brandText(text)).match(WORD) ?? [])
    .map((word) => word.replace(LEADING_JOINERS, ""))
    .filter((word) => LETTER_OR_DIGIT.test(word));
}

function compact(text: string): string {
  return brandText(text).replace(/\s+/gu, "");
}

type BrandNeedle = { substring: string } | { words: string[] };

/** A term in its matching form, or null for a term that matches nothing. */
function brandNeedle(term: string): BrandNeedle | null {
  if (!LETTER_OR_DIGIT.test(term)) return null;
  if (SUBSTRING_SCRIPTS.test(term)) return { substring: compact(term) };
  const words = brandWords(term);
  return words.length ? { words } : null;
}

function holdsSequence(words: string[], needle: string[]): boolean {
  for (let start = 0; start + needle.length <= words.length; start++)
    if (needle.every((word, index) => words[start + index] === word))
      return true;
  return false;
}

/**
 * A query is branded when one brand term stands in it as whole words, in order.
 * Part of a word does not count: "art" does not make "party" branded. A
 * spelling such as "acmeshop" is its own term for the owner to add. A term in a
 * script without spaces matches as a substring. A term with no letter or digit
 * matches nothing. Each term is prepared once per list, not once per query.
 */
export function seoBrandMatcher(terms: string[]): (query: string) => boolean {
  const needles = terms.flatMap((term) => brandNeedle(term) ?? []);
  return (query) => {
    if (!needles.length) return false;
    const words = brandWords(query);
    let compacted: string | undefined;
    return needles.some((needle) =>
      "substring" in needle
        ? (compacted ??= compact(query)).includes(needle.substring)
        : holdsSequence(words, needle.words),
    );
  };
}

export function seoIsBrandedQuery(query: string, terms: string[]): boolean {
  return seoBrandMatcher(terms)(query);
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
  const branded = seoBrandMatcher(terms);
  return rows.filter((row) => branded(row.query) === (view === "branded"));
}

/** Clicks and impressions of the listed branded and non-branded queries. Hidden queries are in neither. */
export function seoBrandTotals(rows: BrandRow[], terms: string[]) {
  const totals = {
    branded: { clicks: 0, impressions: 0 },
    nonBranded: { clicks: 0, impressions: 0 },
  };
  const branded = seoBrandMatcher(terms);
  for (const row of rows) {
    const side = branded(row.query) ? totals.branded : totals.nonBranded;
    side.clicks += row.clicks;
    side.impressions += row.impressions;
  }
  return totals;
}
