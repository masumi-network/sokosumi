/**
 * Bound the contact details the Web Task form adds on save. The block between
 * them is rebuilt from the tagged contacts on every save, so edits and retries
 * never repeat it; text written after it (by the API or an agent) is kept.
 * Rendered Markdown drops the comments.
 */
export const TASK_CONTACT_DETAILS_START = "<!-- sokosumi:contacts -->";
export const TASK_CONTACT_DETAILS_END = "<!-- /sokosumi:contacts -->";
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** A link to a contact in the brief: label in group 1, contact id in group 2. */
export const TASK_CONTACT_LINK =
  /\[((?:\\.|[^\]\\])*)\]\(\/contacts\?contact=([\w-]+)\)/g;

/**
 * Last line of the details block starting at `start`, or -1 when it is not
 * one. Current blocks run to the end marker (no start marker or fence
 * between: saved items are single lines);
 * blocks saved before the end marker existed are only heading and list.
 */
function detailsEnd(lines: readonly string[], start: number): number {
  const end = lines.indexOf(TASK_CONTACT_DETAILS_END, start + 1);
  const inside = lines.slice(start + 1, end);
  if (
    end !== -1 &&
    !inside.some(
      (line) => line === TASK_CONTACT_DETAILS_START || FENCE.test(line),
    )
  )
    return end;
  if (lines[start + 1] !== "" || lines[start + 3] !== "") return -1;
  if (!/^\*\*.*\*\*$/.test(lines[start + 2] ?? "")) return -1;
  let last = start + 3;
  while (lines[last + 1]?.startsWith("- ")) last++;
  return last === start + 3 ? -1 : last;
}

/** Whether `line` closes `fence`: same character, at least as long, nothing after. */
function closesFence(line: string, fence: string): boolean {
  const [, mark, rest = ""] = FENCE.exec(line) ?? [];
  return mark?.[0] === fence[0] && mark.length >= fence.length && !rest.trim();
}

/**
 * The brief without the contact details a save added. Only marker lines
 * outside fenced code count, so a pasted example stays as written. A fence
 * that never closes protects nothing: the block a save appended after it
 * still goes.
 */
export function stripContactDetails(description: string): string {
  const lines = description.split("\n");
  const kept: string[] = [];
  let fence: string | null = null;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const [, mark] = FENCE.exec(line) ?? [];
    if (fence) {
      if (closesFence(line, fence)) fence = null;
    } else if (mark) {
      if (lines.slice(i + 1).some((next) => closesFence(next, mark)))
        fence = mark;
    } else if (line === TASK_CONTACT_DETAILS_START) {
      const end = detailsEnd(lines, i);
      if (end !== -1) {
        changed = true;
        while (kept.at(-1)?.trim() === "") kept.pop();
        i = end;
        while (lines[i + 1]?.trim() === "") i++;
        if (kept.length > 0 && i + 1 < lines.length) kept.push("");
        continue;
      }
    }
    kept.push(line);
  }
  return changed ? kept.join("\n").trim() : description;
}

/** Contact links as their plain names, for readers outside the workspace. */
export function unlinkContacts(markdown: string): string {
  return markdown.replace(TASK_CONTACT_LINK, "$1");
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether `next` keeps what a person wrote in `previous`. Besides the
 * rebuilt details block and renamed or merged links, a save turns the link
 * to an archived, missing or moved contact into its plain label, so each
 * earlier link may come back as a link or as that label.
 */
export function sameAuthoredBrief(previous: string, next: string): boolean {
  const before = stripContactDetails(previous).trim();
  let pattern = "";
  let last = 0;
  for (const match of before.matchAll(TASK_CONTACT_LINK)) {
    pattern += `${escapeRegExp(before.slice(last, match.index))}(?:${TASK_CONTACT_LINK.source}|${escapeRegExp(match[1] ?? "")})`;
    last = match.index + match[0].length;
  }
  pattern += escapeRegExp(before.slice(last));
  return new RegExp(`^${pattern}$`).test(stripContactDetails(next).trim());
}
