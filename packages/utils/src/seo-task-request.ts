/**
 * An SEO Task's description: a readable summary for people, then one machine
 * line (`seo_audit: {json}` or `seo_job: {json}`) that the SEO worker parses.
 * The worker reads exactly one such line and ignores the prose around it.
 */
export type SeoTaskMarker = "seo_audit" | "seo_job";

const REQUEST_LINE = /^\s*seo_(?:audit|job)\s*:/i;
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

const isRequestLine = (line: string, markers: readonly SeoTaskMarker[]) => {
  const marker = /^\s*(seo_(?:audit|job))\s*:/i.exec(line)?.[1].toLowerCase();
  if (!markers.some((wanted) => wanted === marker)) return false;
  try {
    const value: unknown = JSON.parse(line.replace(REQUEST_LINE, ""));
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
  markers: readonly SeoTaskMarker[] = ["seo_audit", "seo_job"],
): string {
  return markdown
    .split(LINE_BREAK)
    .filter((line) => !isRequestLine(line, markers))
    .join("\n")
    .trim();
}
