import { emoticon } from "emoticon";

export interface ComposerEmoticonMatch {
  start: number;
  end: number;
  emoji: string;
}

const BOUNDARY_PUNCT = new Set([".", "!", "?", ",", ";", ":"]);

/** Longest-first emoticon → emoji map from the same source as remark-emoji. */
const EMOTICON_ENTRIES: ReadonlyArray<{ text: string; emoji: string }> =
  (() => {
    const byText = new Map<string, string>();
    for (const entry of emoticon) {
      for (const ascii of entry.emoticons) {
        if (!byText.has(ascii)) {
          byText.set(ascii, entry.emoji);
        }
      }
    }
    return [...byText.entries()]
      .map(([text, emoji]) => ({ text, emoji }))
      .sort((a, b) => b.text.length - a.text.length);
  })();

function isWhitespace(char: string | undefined): boolean {
  return char != null && char.trim() === "";
}

function isLiveBoundaryChar(char: string | undefined): boolean {
  if (char == null || char === "") return false;
  return isWhitespace(char) || BOUNDARY_PUNCT.has(char);
}

/**
 * Match a complete ASCII emoticon closed at caret by a boundary (or flush).
 * `end` is exclusive of the emoticon only — boundary char is not consumed.
 */
export function matchEmoticonClosedAtBoundary(
  text: string,
  caret: number,
  options?: { flush?: boolean },
): ComposerEmoticonMatch | null {
  const clampedCaret = Math.max(0, Math.min(caret, text.length));
  const flush = options?.flush === true;

  let windowEnd: number;
  if (flush && clampedCaret === text.length) {
    windowEnd = clampedCaret;
  } else if (clampedCaret > 0 && isLiveBoundaryChar(text[clampedCaret - 1])) {
    windowEnd = clampedCaret - 1;
  } else {
    return null;
  }

  if (windowEnd <= 0) return null;
  const window = text.slice(0, windowEnd);

  for (const entry of EMOTICON_ENTRIES) {
    if (!window.endsWith(entry.text)) continue;
    const start = windowEnd - entry.text.length;
    const charBefore = start > 0 ? text[start - 1] : undefined;
    if (start > 0 && !isWhitespace(charBefore)) continue;
    return { start, end: windowEnd, emoji: entry.emoji };
  }

  return null;
}
