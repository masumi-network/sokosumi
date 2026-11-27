/** Curly quotes and apostrophes as plain ones, so a pattern written with ' matches a reply typed with ’. */
export function plainQuotes(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
}

/** A check pattern tested against text, both with plain quotes. */
export function checkPattern(pattern: string, flags = "i"): RegExp {
  return new RegExp(plainQuotes(pattern), flags);
}

/** True when text matches the pattern, ignoring the quote style. */
export function matchesText(text: string, pattern: string): boolean {
  return checkPattern(pattern).test(plainQuotes(text));
}

// A negation word, then up to 30 characters of the same clause, then the match.
const NEGATED_BEFORE =
  /\b(?:no|not|never|without|except|excluding|exclude|omit|omitting|skip|skipping|drop|dropping|remove|removing|avoid|avoiding|leave out|leaving out|don't|do not)\b[^.!?;:\n]{0,30}$/i;

/**
 * True when text says what the pattern names, not only that it is left out:
 * "without the stuck section" and "no prices" do not mention stuck work or
 * prices. For the "avoids" checks on what the bot wrote (a brief, an image
 * prompt, a file), where leaving something out is said by naming it.
 */
export function mentionsAffirmed(text: string, pattern: string): boolean {
  const plain = plainQuotes(text);
  for (const match of plain.matchAll(checkPattern(pattern, "gi"))) {
    const before = plain.slice(Math.max(0, match.index - 60), match.index);
    if (!NEGATED_BEFORE.test(before)) return true;
  }
  return false;
}
