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

// An exclusion, then at most six words of the list it governs, ending right
// before the match: "without the stuck section", "no prices, plan names or".
const EXCLUSION_BEFORE =
  /\b(?:without|no|except|excluding|exclude|omit|omitting|skip|skipping|drop|dropping|remove|removing|avoid|avoiding|leave out|leaving out|(?:do not|don't|never|not) (?:include|mention|show|list|add|cover|use))((?:[\s,]+[\w'/-]+){0,6})[\s,]*$/i;
// A word that starts something new the exclusion no longer governs.
const CONTRAST =
  /\b(?:but|include|including|list|show|add|keep|mention|use|cover|also|then|instead|forget|miss)\b/i;

/**
 * True when text says what the pattern names, not only that it is left out:
 * "without the stuck section" and "no prices" do not mention stuck work or
 * prices; "exclude names but include prices" does. For the "avoids" checks on
 * what the bot wrote (a brief, an image prompt, a file), where leaving
 * something out is said by naming it.
 */
export function mentionsAffirmed(text: string, pattern: string): boolean {
  const plain = plainQuotes(text);
  for (const match of plain.matchAll(checkPattern(pattern, "gi"))) {
    const before = plain.slice(Math.max(0, match.index - 80), match.index);
    const exclusion = EXCLUSION_BEFORE.exec(before);
    if (!exclusion || CONTRAST.test(exclusion[1] ?? "")) return true;
  }
  return false;
}
