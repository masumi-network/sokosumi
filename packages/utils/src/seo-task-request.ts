/**
 * An SEO Task's description: a readable summary for people, then one machine
 * line (`seo_audit: {json}`, `seo_job: {json}` or `seo_crawl_next: {json}`)
 * that the SEO worker parses. The worker reads exactly one such line and
 * ignores the prose around it.
 */
export type SeoTaskMarker = "seo_audit" | "seo_job" | "seo_crawl_next";

const ALL_MARKERS: readonly SeoTaskMarker[] = [
  "seo_audit",
  "seo_job",
  "seo_crawl_next",
];

/** The markers whose line holds the owner's price terms, which only the SEO worker reads. */
export const SEO_PRIVATE_MARKERS: readonly SeoTaskMarker[] = [
  "seo_audit",
  "seo_crawl_next",
];

/**
 * JavaScript's `\s` (also the set `trim` removes), written out: Core's Task
 * search runs the same line rule in SQL, and Postgres reads `\s` as another set.
 */
export const SEO_LINE_SPACE = String.raw`[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]`;

/** The start of a request line of any of `markers` (case-insensitive), as regex source for JS and Postgres. */
export function seoRequestLinePrefix(
  markers: SeoTaskMarker | readonly SeoTaskMarker[],
): string {
  const names = typeof markers === "string" ? markers : markers.join("|");
  return `^${SEO_LINE_SPACE}*(?:${names})${SEO_LINE_SPACE}*:`;
}

const REQUEST_LINE = new RegExp(seoRequestLinePrefix(ALL_MARKERS), "i");
const PREFIX = Object.fromEntries(
  ALL_MARKERS.map((marker) => [
    marker,
    new RegExp(seoRequestLinePrefix(marker), "i"),
  ]),
) as Record<SeoTaskMarker, RegExp>;
const LINE_BREAK = /\r?\n/;

export function seoTaskDescription(
  summary: string,
  marker: SeoTaskMarker,
  packet: unknown,
): string {
  return `${summary.trim()}\n\n${marker}: ${JSON.stringify(packet)}`;
}

/**
 * The JSON of the description's only request line. Throws when the line is
 * missing, repeated, of the other marker, or not JSON: a Task with two
 * requests is ambiguous, as it is for the worker.
 */
export function seoTaskRequestPacket(
  description: string,
  marker: SeoTaskMarker,
): unknown {
  const lines = description
    .split(LINE_BREAK)
    .filter((line) => REQUEST_LINE.test(line));
  const prefix = new RegExp(`^\\s*${marker}\\s*:`, "i");
  if (lines.length !== 1 || !prefix.test(lines[0]))
    throw new Error(`Expected exactly one ${marker} line`);
  return JSON.parse(lines[0].replace(prefix, ""));
}

/**
 * A request line: the marker, then JSON that is an object or an array. Core's
 * Task search has a SQL twin of this rule (`visibleDescriptionSql`); a parity
 * test runs the same cases through both.
 */
const isRequestLine = (line: string, markers: readonly SeoTaskMarker[]) => {
  const prefix = markers
    .map((marker) => PREFIX[marker])
    .find((pattern) => pattern.test(line));
  if (!prefix) return false;
  try {
    const value: unknown = JSON.parse(line.replace(prefix, ""));
    return typeof value === "object" && value !== null;
  } catch {
    return false;
  }
};

/**
 * The description without its machine request lines, for display. Only a
 * marker with a JSON object counts: prose such as "SEO_job: fix titles" in
 * an ordinary Task stays visible.
 */
export function removeSeoTaskRequest(
  markdown: string,
  markers: readonly SeoTaskMarker[] = ALL_MARKERS,
): string {
  const lines = markdown.split(LINE_BREAK);
  const kept = lines.filter((line) => !isRequestLine(line, markers));
  // Text without a request line is left exactly as written (indentation, line breaks).
  return kept.length === lines.length ? markdown : kept.join("\n").trim();
}

/** True when the description holds a request line of this marker (a JSON object). */
export function hasSeoTaskRequest(
  markdown: string | null | undefined,
  marker: SeoTaskMarker,
): boolean {
  return (
    Boolean(markdown) && removeSeoTaskRequest(markdown!, [marker]) !== markdown
  );
}

/**
 * Text for a person: a full audit's and a crawl continuation's request line
 * hold the owner's price terms, which only the SEO worker reads. A focused
 * check's line stays.
 */
export function hideSeoAuditRequest(
  text: string | null | undefined,
): string | null {
  return text ? removeSeoTaskRequest(text, SEO_PRIVATE_MARKERS) || null : null;
}

/**
 * A description split into its prose and its request lines (`seo_audit:`,
 * `seo_job:` or `seo_crawl_next:`), so a prose edit never reaches inside the JSON the worker
 * parses. Text without a request line is all prose, unchanged. `join` puts
 * edited prose back in front of the request lines, byte for byte.
 */
export function splitSeoTaskRequest(markdown: string): {
  prose: string;
  join: (prose: string) => string;
} {
  const lines = markdown.split(LINE_BREAK);
  const requests = lines.filter((line) => isRequestLine(line, ALL_MARKERS));
  if (requests.length === 0) return { prose: markdown, join: (prose) => prose };
  return {
    prose: lines.filter((line) => !requests.includes(line)).join("\n"),
    join: (prose) => [prose, requests.join("\n")].filter(Boolean).join("\n\n"),
  };
}
