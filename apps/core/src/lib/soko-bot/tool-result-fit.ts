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
 * reads cut themselves at 24 KB with their own note (`cmo-reads.ts`); a skill
 * read is Core's own text, which the model must follow whole (the strategy
 * skill is about 50k characters).
 */
const UNCAPPED_RESULTS: ReadonlySet<string> = new Set([
  "refresh_context",
  "read_memory",
  "read_calendar",
  "read_strategy",
  "read_brand_brain",
  "read_report",
  "read_competitor_moves",
  "read_skill",
  "read_writing_skill",
]);

const SHORTENED_NOTE =
  "This result was too long to show whole, so the end of the lists above is left out (see omitted). Ask again more narrowly: a smaller limit, a filter, a date range, or the next page.";

type Json = unknown;

const MAX_TRIM_ROUNDS = 40;

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

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lastId(items: Json): unknown {
  const last = Array.isArray(items) ? items.at(-1) : undefined;
  return isRecord(last) ? last.id : undefined;
}

/**
 * What a cut page says about the rest. A page cursor names the page's last
 * item, so paging on from it would skip the items left out: when the cursor
 * is that item's id, it moves to the last item shown.
 */
function pagingNote(
  original: Json,
  copy: Json,
  omitted: Record<string, number>,
): string {
  if (!isRecord(original) || !isRecord(copy)) return "";
  const pagination = copy.pagination;
  const before = original.pagination;
  if (!isRecord(pagination) || !isRecord(before)) return "";
  const cut = Object.keys(omitted).filter((key) => Array.isArray(copy[key]));
  const path =
    cut.find(
      (key) =>
        before.nextCursor != null &&
        lastId(original[key]) === before.nextCursor,
    ) ?? (cut.length === 1 ? cut[0] : undefined);
  const page = path === undefined ? undefined : copy[path];
  if (path === undefined || !Array.isArray(page)) return "";
  const shown = page.length;
  const total =
    typeof before.total === "number" ? ` ${before.total} in all.` : "";
  const counted = `This page shows ${shown} of its ${shown + omitted[path]} ${path}.${total}`;
  const keptLast = lastId(page);
  if (
    typeof before.nextCursor === "string" &&
    before.nextCursor === lastId(original[path]) &&
    typeof keptLast === "string"
  ) {
    pagination.nextCursor = keptLast;
    return `${counted} pagination.nextCursor continues right after the last one shown.`;
  }
  if (before.nextCursor === null || before.nextCursor === undefined)
    return `${counted} Ask again with limit ${shown} to see the rest of this page.`;
  return `${counted} Paging on with pagination.nextCursor would skip the ones left out: ask again with limit ${shown} instead.`;
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
  // Each round serializes the whole result again: a result of many small
  // lists goes to the text preview instead of thousands of rounds.
  for (let round = 0; round < MAX_TRIM_ROUNDS; round++) {
    const found = longestArray(copy, "");
    if (!found || found.items.length <= 1) break;
    const drop = Math.max(1, Math.ceil(found.items.length / 4));
    found.items.splice(found.items.length - drop, drop);
    omitted[found.path || "result"] =
      (omitted[found.path || "result"] ?? 0) + drop;
    const paging = pagingNote(result, copy, omitted);
    const note = paging ? `${SHORTENED_NOTE} ${paging}` : SHORTENED_NOTE;
    if (size({ result: copy, omitted, note }) <= TOOL_RESULT_MAX_CHARS)
      return { result: copy, omitted, note };
  }
  const text = JSON.stringify(copy) ?? "";
  // The list of what was left out can itself grow past the cap (thousands of
  // nested lists); then only its total is kept.
  const left: Record<string, number> =
    size(omitted) <= TOOL_RESULT_MAX_CHARS / 4
      ? omitted
      : { items: Object.values(omitted).reduce((sum, n) => sum + n, 0) };
  const shortened = (length: number) => ({
    preview: text.slice(0, Math.max(0, length)).toWellFormed(),
    ...(Object.keys(left).length ? { omitted: left } : {}),
    note: SHORTENED_NOTE,
  });
  let length = TOOL_RESULT_MAX_CHARS;
  // Quotes and backslashes grow when the preview is encoded again.
  while (length > 0 && size(shortened(length)) > TOOL_RESULT_MAX_CHARS)
    length -= Math.max(1, size(shortened(length)) - TOOL_RESULT_MAX_CHARS);
  return shortened(length);
}
