import { nameToEmoji } from "gemoji";

const DEFAULT_EMOJI_RESULT_CAP = 20;
const EMOJI_QUERY_PATTERN = /^[a-z0-9_+-]*$/i;

/** Public emoji row — unicode + shortcode name only. */
export interface EmojiShortcodeMatch {
  name: string;
  emoji: string;
}

interface EmojiShortcodeRegistryEntry {
  name: string;
  emoji: string;
}

const EMOJI_SHORTCODE_REGISTRY: readonly EmojiShortcodeRegistryEntry[] =
  Object.entries(nameToEmoji)
    .map(([name, emoji]) => ({ name, emoji }))
    .toSorted((a, b) => a.name.localeCompare(b.name));

const EMOJI_BY_NAME = new Map(
  EMOJI_SHORTCODE_REGISTRY.map((entry) => [entry.name, entry.emoji]),
);

/**
 * Pure filter over the static registry. Prefix matches first, then includes.
 * Empty query → stable alphabetical top-N.
 */
export function filterEmojiShortcodes(
  query: string,
  cap: number = DEFAULT_EMOJI_RESULT_CAP,
): EmojiShortcodeMatch[] {
  const limit = Math.max(0, cap);
  if (limit === 0) return [];

  const normalizedQuery = query.toLowerCase();
  if (normalizedQuery.length === 0) {
    return EMOJI_SHORTCODE_REGISTRY.slice(0, limit).map((entry) => ({
      name: entry.name,
      emoji: entry.emoji,
    }));
  }

  const prefixMatches: EmojiShortcodeMatch[] = [];
  const includesMatches: EmojiShortcodeMatch[] = [];

  for (const entry of EMOJI_SHORTCODE_REGISTRY) {
    if (entry.name.startsWith(normalizedQuery)) {
      prefixMatches.push({ name: entry.name, emoji: entry.emoji });
      continue;
    }
    if (entry.name.includes(normalizedQuery)) {
      includesMatches.push({ name: entry.name, emoji: entry.emoji });
    }
  }

  return [...prefixMatches, ...includesMatches].slice(0, limit);
}

/**
 * Optional: exact `:name:` just closed at caret → unicode for auto-insert.
 */
export function matchExactEmojiShortcodeClosed(
  text: string,
  caret: number,
): { triggerStart: number; end: number; emoji: string } | null {
  const clampedCaret = Math.max(0, Math.min(caret, text.length));
  if (clampedCaret < 3) return null;
  if (text[clampedCaret - 1] !== ":") return null;

  let openIndex = -1;
  for (let index = clampedCaret - 2; index >= 0; index -= 1) {
    const char = text[index] ?? "";
    if (char.trim() === "") break;
    if (char === ":") {
      openIndex = index;
      break;
    }
  }
  if (openIndex < 0) return null;
  if (openIndex > 0 && (text[openIndex - 1] ?? "").trim() !== "") {
    return null;
  }

  const name = text.slice(openIndex + 1, clampedCaret - 1);
  if (name.length === 0 || !EMOJI_QUERY_PATTERN.test(name)) return null;
  if (name.includes(":")) return null;

  const emoji = EMOJI_BY_NAME.get(name.toLowerCase());
  if (!emoji) return null;

  return { triggerStart: openIndex, end: clampedCaret, emoji };
}

export { DEFAULT_EMOJI_RESULT_CAP as EMOJI_RESULT_CAP };
