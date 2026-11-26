/**
 * Most characters of one tool result the model is given. Every later step of
 * the turn sends it again until history compaction, and Composio, MCP and
 * file reads returned up to 200k characters.
 */
export const TOOL_RESULT_MAX_CHARS = 16_000;

/** Runtime event naming a call whose result the model got shortened. */
export const TOOL_RESULT_SHORTENED_EVENT = "action.result_shortened";

/**
 * Reads bounded already, and whole documents a cut copy would harm: the
 * context packet has its own byte budget; memory is at most 16 KB and
 * update_memory replaces all of it, so the model must see every entry; Cuso's
 * reads cut themselves at 24 KB with their own note (`cmo-reads.ts`).
 */
const UNCAPPED_RESULTS: ReadonlySet<string> = new Set([
  "refresh_context",
  "read_memory",
  "read_calendar",
  "read_strategy",
  "read_brand_brain",
  "read_report",
  "read_competitor_moves",
]);

const SHORTENED_NOTE =
  "This result was too long to show whole, so the end of the lists above is left out (see omitted). Ask again more narrowly: a smaller limit, a filter, a date range, or the next page.";

type Json = unknown;

function size(value: Json): number {
  return JSON.stringify(value)?.length ?? 0;
}

/** The longest array anywhere in `value`, with a way to shorten it in place. */
function longestArray(
  value: Json,
  path: string,
): { path: string; items: Json[] } | null {
  if (Array.isArray(value)) {
    const nested = value
      .map((item, index) => longestArray(item, `${path}[${index}]`))
      .filter((found) => found !== null);
    const own = { path, items: value };
    return [own, ...nested].reduce((best, found) =>
      found.items.length > best.items.length ? found : best,
    );
  }
  if (value && typeof value === "object") {
    let best: { path: string; items: Json[] } | null = null;
    for (const [key, entry] of Object.entries(value)) {
      const found = longestArray(entry, path ? `${path}.${key}` : key);
      if (found && (!best || found.items.length > best.items.length))
        best = found;
    }
    return best;
  }
  return null;
}

/**
 * A tool result the model can still use when it is too long: items are left
 * off the end of its longest lists, and it says how many and how to ask for
 * the rest. A result that is one long text is cut with the same note.
 */
export function fitToolResult(capability: string, result: Json): Json {
  if (UNCAPPED_RESULTS.has(capability)) return result;
  if (size(result) <= TOOL_RESULT_MAX_CHARS) return result;
  const copy: Json = structuredClone(result);
  const omitted: Record<string, number> = {};
  for (;;) {
    const found = longestArray(copy, "");
    if (!found || found.items.length <= 1) break;
    const drop = Math.max(1, Math.ceil(found.items.length / 4));
    found.items.splice(found.items.length - drop, drop);
    omitted[found.path || "result"] =
      (omitted[found.path || "result"] ?? 0) + drop;
    if (
      size({ result: copy, omitted, note: SHORTENED_NOTE }) <=
      TOOL_RESULT_MAX_CHARS
    )
      return { result: copy, omitted, note: SHORTENED_NOTE };
  }
  const text = JSON.stringify(copy) ?? "";
  const shortened = (length: number) => ({
    preview: text.slice(0, length).toWellFormed(),
    ...(Object.keys(omitted).length ? { omitted } : {}),
    note: SHORTENED_NOTE,
  });
  let length = TOOL_RESULT_MAX_CHARS;
  // Quotes and backslashes grow when the preview is encoded again.
  while (size(shortened(length)) > TOOL_RESULT_MAX_CHARS)
    length -= size(shortened(length)) - TOOL_RESULT_MAX_CHARS;
  return shortened(length);
}
