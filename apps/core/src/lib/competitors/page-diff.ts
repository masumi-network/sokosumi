import { htmlToText } from "@/soko-bot-runner/local-tools";

const MAX_LINE_CHARS = 300;
const MAX_LINES = 1_500;
/** Below this a page is a shell or a block notice, not its content. */
export const MIN_PAGE_CHARS = 200;

const MONTH =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE = new RegExp(
  [
    "\\b\\d{4}-\\d{2}-\\d{2}\\b",
    "\\b\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}\\b",
    `\\b(?:${MONTH})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`,
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH})\\.?(?:,?\\s+\\d{4})?\\b`,
    `\\b(?:${MONTH})\\.?\\s+\\d{4}\\b`,
  ].join("|"),
  "gi",
);
const CLOCK = /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?\b/gi;
const AGO =
  /\b(?:\d+|an?|few)\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b|\b(?:today|yesterday|just now)\b/gi;
const YEAR = /\b(?:19|20)\d{2}\b/g;
/** "10,432 teams", "2.5M downloads", "500+ reviews": numbers that tick up. */
const COUNTER =
  /\b\d{1,3}(?:[,.\s]\d{3})+\+?|\b\d+(?:\.\d+)?\s?[kmb]\b\+?|\b\d{3,}\+?/gi;

const CURRENCY = "[$€£¥₹]|USD|EUR|GBP|CHF|CAD|AUD";
const AMOUNT = "\\d+(?:[,.]\\d+)*(?:\\s?[kK])?";
export const PRICE = new RegExp(
  `(?:${CURRENCY})\\s?${AMOUNT}|${AMOUNT}\\s?(?:${CURRENCY})(?![a-z])`,
  "g",
);

/** A line that is consent, legal or session text on any site. */
const BOILERPLATE = [
  /\bcookies?\b/i,
  /\bconsent\b/i,
  /\bgdpr\b/i,
  /^(?:accept|reject|decline|allow)(?: all)?$/i,
  /^(?:©|\(c\)|copyright\b)/i,
  /\ball rights reserved\b/i,
  /^(?:last )?(?:updated|modified|reviewed)\b/i,
  /^(?:skip to|jump to) /i,
  /^(?:sign|log) ?(?:in|up|out)$/i,
  /^loading\b/i,
];

/** Tags that start a new statement but that `htmlToText` leaves inline. */
const BLOCK_EDGE =
  /<\/?(?:button|h[1-6]|section|header|footer|nav|td|th|label|summary|figcaption|blockquote|dt|dd)\b/gi;

/**
 * The text a line is compared by: dates, clock times, "3 days ago" and
 * ticking counters are blanked so they never read as a change. Prices stay,
 * because a price is the change worth knowing.
 */
export function lineKey(line: string): string {
  const prices: string[] = [];
  const held = line.replace(PRICE, (price) => {
    prices.push(price.replace(/\s+/g, ""));
    return ` \u0000${prices.length - 1}\u0000 `;
  });
  return held
    .replace(DATE, " ")
    .replace(CLOCK, " ")
    .replace(AGO, " ")
    .replace(YEAR, " ")
    .replace(COUNTER, " ")
    .replace(
      /\u0000(\d+)\u0000/g,
      (_match, index: string) => prices[Number(index)] ?? "",
    )
    .replace(/[^\p{L}\p{N}$€£¥₹.,%]+/gu, " ")
    .trim()
    .toLowerCase();
}

/**
 * A page as the lines a reader sees, in order, each once, without consent
 * banners, legal footers and lines that are only a date or a counter.
 */
export function pageLines(html: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of htmlToText(html.replace(BLOCK_EDGE, "\n$&")).split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim().slice(0, MAX_LINE_CHARS);
    if (line.length < 2) continue;
    if (BOILERPLATE.some((pattern) => pattern.test(line))) continue;
    const key = lineKey(line);
    if (!/[\p{L}\p{N}]/u.test(key) || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
    if (lines.length >= MAX_LINES) break;
  }
  return lines;
}

/**
 * The lines both reads of one page share. A banner, a testimonial or a
 * "trusted by" logo that rotates per visit is in only one of them.
 */
export function stableLines(first: string[], second: string[]): string[] {
  const keys = new Set(second.map(lineKey));
  return first.filter((line) => keys.has(lineKey(line)));
}

export interface PageDiff {
  added: string[];
  removed: string[];
}

/** What a page says now that it did not, and what it no longer says. */
export function diffLines(before: string[], after: string[]): PageDiff {
  const beforeKeys = new Set(before.map(lineKey));
  const afterKeys = new Set(after.map(lineKey));
  return {
    added: after.filter((line) => !beforeKeys.has(lineKey(line))),
    removed: before.filter((line) => !afterKeys.has(lineKey(line))),
  };
}

/** Every price a page lists, in order, without spaces ("$12", "18€"). */
export function pagePrices(lines: readonly string[]): string[] {
  return lines.flatMap((line) =>
    (line.match(PRICE) ?? []).map((price) => price.replace(/\s+/g, "")),
  );
}

/** A type alias: it is stored in `competitor_signal.raw`. */
export type PriceMove = {
  /** Prices the page no longer lists. */
  before: string[];
  /** Prices the page lists now and did not. */
  after: string[];
};

/**
 * The prices that differ between two readings of a page, each counted as
 * often as it stands there. Null when the page lists the same prices, however
 * the words around them changed.
 */
export function priceMove(
  before: readonly string[],
  after: readonly string[],
): PriceMove | null {
  const left = [...pagePrices(after)];
  const gone: string[] = [];
  for (const price of pagePrices(before)) {
    const index = left.indexOf(price);
    if (index === -1) gone.push(price);
    else left.splice(index, 1);
  }
  return gone.length === 0 && left.length === 0
    ? null
    : { before: gone, after: left };
}

/** Each line with the two lines above it on the page: what a price is for. */
export function withLinesAbove(
  lines: readonly string[],
  page: readonly string[],
): { line: string; above: string[] }[] {
  return lines.map((line) => {
    const index = page.indexOf(line);
    return {
      line,
      above: index > 0 ? page.slice(Math.max(0, index - 2), index) : [],
    };
  });
}
