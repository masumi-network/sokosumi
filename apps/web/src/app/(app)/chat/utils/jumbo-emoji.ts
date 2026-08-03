/**
 * Slack-style "jumbomoji": emoji-only messages (≤23) render larger.
 * Whitespace between emoji is ignored; any non-emoji grapheme disables jumbo.
 */

/** Slack's jumbo threshold — 24+ emoji stay normal size. */
export const MAX_JUMBO_EMOJI_COUNT = 23;

const graphemeSegmenter = new Intl.Segmenter("en", {
  granularity: "grapheme",
});

/**
 * True when a grapheme is a single emoji presentation (flags, ZWJ sequences,
 * keycaps, skin tones included — Segmenter already collapses those).
 */
function isEmojiGrapheme(grapheme: string): boolean {
  if (/\p{Extended_Pictographic}/u.test(grapheme)) {
    return true;
  }
  // Flags: two regional indicator symbols (e.g. 🇩🇪)
  if (/^\p{Regional_Indicator}{2}$/u.test(grapheme)) {
    return true;
  }
  // Keycap sequences (e.g. 1️⃣) when not already matched as Extended_Pictographic
  if (/^[#*0-9]\uFE0F?\u20E3$/u.test(grapheme)) {
    return true;
  }
  return false;
}

/**
 * Returns the emoji count when `content` is jumbo-eligible, otherwise `null`.
 */
export function getJumboEmojiCount(content: string): number | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  let count = 0;
  for (const { segment } of graphemeSegmenter.segment(trimmed)) {
    if (/^\s+$/u.test(segment)) {
      continue;
    }
    if (!isEmojiGrapheme(segment)) {
      return null;
    }
    count += 1;
    if (count > MAX_JUMBO_EMOJI_COUNT) {
      return null;
    }
  }

  return count > 0 ? count : null;
}

/** Tailwind size class for a jumbo emoji count (larger when fewer emoji). */
export function jumboEmojiClassName(count: number): string {
  if (count <= 1) {
    return "text-5xl leading-none";
  }
  if (count <= 3) {
    return "text-4xl leading-none";
  }
  if (count <= 6) {
    return "text-3xl leading-snug";
  }
  return "text-2xl leading-snug";
}
