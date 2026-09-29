/**
 * Bold, italic and underline for Social post text.
 *
 * No network's posting API takes rich text, so formatting is carried in the
 * characters themselves: Unicode's mathematical sans-serif letters for bold
 * and italic, and a combining low line for underline. They survive every
 * network's API as they are, the way scheduling tools format posts.
 */
export type SocialPostTextStyle = "bold" | "italic" | "underline";

const UNDERLINE = "̲";

// Offsets into the Mathematical Alphanumeric Symbols block.
const STYLE_STARTS = {
  bold: { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
  italic: { upper: 0x1d608, lower: 0x1d622, digit: null },
} as const;

function styleChar(char: string, style: "bold" | "italic"): string {
  const code = char.codePointAt(0) ?? 0;
  const starts = STYLE_STARTS[style];
  if (code >= 65 && code <= 90) {
    return String.fromCodePoint(starts.upper + code - 65);
  }
  if (code >= 97 && code <= 122) {
    return String.fromCodePoint(starts.lower + code - 97);
  }
  if (code >= 48 && code <= 57 && starts.digit !== null) {
    return String.fromCodePoint(starts.digit + code - 48);
  }
  return char;
}

function plainChar(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  for (const starts of Object.values(STYLE_STARTS)) {
    if (code >= starts.upper && code < starts.upper + 26) {
      return String.fromCharCode(65 + code - starts.upper);
    }
    if (code >= starts.lower && code < starts.lower + 26) {
      return String.fromCharCode(97 + code - starts.lower);
    }
    if (
      starts.digit !== null &&
      code >= starts.digit &&
      code < starts.digit + 10
    ) {
      return String.fromCharCode(48 + code - starts.digit);
    }
  }
  return char;
}

/** Whether every letter or digit in `text` already carries `style`. */
export function hasSocialPostTextStyle(
  text: string,
  style: SocialPostTextStyle,
): boolean {
  const chars = [...text];
  if (style === "underline") {
    const letters = chars.filter((char) => char !== UNDERLINE && char.trim());
    return (
      letters.length > 0 &&
      chars.every(
        (char, index) =>
          char === UNDERLINE || !char.trim() || chars[index + 1] === UNDERLINE,
      )
    );
  }
  const styleable = chars.filter(
    (char) => styleChar(plainChar(char), style) !== plainChar(char),
  );
  return (
    styleable.length > 0 &&
    styleable.every((char) => styleChar(plainChar(char), style) === char)
  );
}

/**
 * Turns `style` on for `text`, or off when it is already on. Bold and italic
 * replace each other, since a character is one or the other.
 */
export function toggleSocialPostTextStyle(
  text: string,
  style: SocialPostTextStyle,
): string {
  const on = hasSocialPostTextStyle(text, style);
  if (style === "underline") {
    const bare = text.replaceAll(UNDERLINE, "");
    if (on) return bare;
    return [...bare]
      .map((char) => (char.trim() ? char + UNDERLINE : char))
      .join("");
  }
  return [...text]
    .map((char) => {
      if (char === UNDERLINE) return char;
      const plain = plainChar(char);
      return on ? plain : styleChar(plain, style);
    })
    .join("");
}
