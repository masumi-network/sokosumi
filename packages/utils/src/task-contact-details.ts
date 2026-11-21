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

/**
 * The brief without the contact details a save added. Only marker lines
 * outside fenced code count, so a pasted example stays as written.
 */
export function stripContactDetails(description: string): string {
  const lines = description.split("\n");
  const kept: string[] = [];
  let fence: string | null = null;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const [, mark, rest = ""] = FENCE.exec(line) ?? [];
    if (fence) {
      // A closing fence: same character, at least as long, nothing after.
      if (mark?.[0] === fence[0] && mark.length >= fence.length && !rest.trim())
        fence = null;
    } else if (mark) {
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

/**
 * What a person wrote in the brief: no contact details block, and each
 * contact link as one placeholder. A save rebuilds the block and points links
 * at a renamed or merged contact, so only a change outside those is new
 * instructions.
 */
export function authoredTaskBrief(description: string): string {
  return stripContactDetails(description)
    .replace(TASK_CONTACT_LINK, "@contact")
    .trim();
}
