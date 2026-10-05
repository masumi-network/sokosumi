/**
 * Tag and category naming rules for the Files vocabulary.
 *
 * Shared because Core enforces them on write and Web has to show the same
 * limit while someone types, and two copies of "what counts as the same tag"
 * is how a workspace ends up with `Aurora` and `aurora` as separate labels.
 */

export const FILE_LABEL_NAME_MAX_GRAPHEMES = 40;
export const FILE_LABEL_DESCRIPTION_MAX_LENGTH = 280;
/** Confirmed tags one file may carry. */
export const FILE_TAGS_PER_RESOURCE_MAX = 20;

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** Grapheme clusters, so an emoji or a combining accent counts once. */
export function countGraphemes(value: string): number {
  if (!graphemeSegmenter) return [...value].length;
  let count = 0;
  for (const _ of graphemeSegmenter.segment(value)) count += 1;
  return count;
}

/**
 * The form a label is stored and compared in: NFC, trimmed, inner whitespace
 * collapsed, case-folded. Display capitalization is kept separately.
 */
export function normalizeFileLabelName(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

/** The form a label is shown in: NFC and trimmed, capitalization preserved. */
export function displayFileLabelName(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export type FileLabelNameProblem =
  | "empty"
  | "too-long"
  | "markup"
  | "control-characters";

export interface FileLabelNameCheck {
  valid: boolean;
  problem?: FileLabelNameProblem;
  displayName: string;
  normalizedName: string;
}

/**
 * C0 controls and DEL. Checked by code point rather than by a regular
 * expression so the literal control bytes never end up in this source file.
 */
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * A label name is text, not markup. `<` and `>` are rejected outright rather
 * than escaped so a tag can never be stored as something that has to be
 * sanitized again at every render site.
 */
export function checkFileLabelName(value: string): FileLabelNameCheck {
  const displayName = displayFileLabelName(value);
  const normalizedName = normalizeFileLabelName(value);

  if (normalizedName.length === 0) {
    return { valid: false, problem: "empty", displayName, normalizedName };
  }
  if (hasControlCharacters(displayName)) {
    return {
      valid: false,
      problem: "control-characters",
      displayName,
      normalizedName,
    };
  }
  if (displayName.includes("<") || displayName.includes(">")) {
    return { valid: false, problem: "markup", displayName, normalizedName };
  }
  if (countGraphemes(displayName) > FILE_LABEL_NAME_MAX_GRAPHEMES) {
    return { valid: false, problem: "too-long", displayName, normalizedName };
  }

  return { valid: true, displayName, normalizedName };
}

/**
 * The form a filename is matched on. An exact hit here outranks every model
 * score, so it has to be stable: NFC, lowercase, whitespace collapsed.
 */
export function normalizeFileResourceName(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}
