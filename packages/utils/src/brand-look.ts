/**
 * What a brand looks like, read from its CSS or its DESIGN.md: colours,
 * fonts and, for a DESIGN.md, its tone of voice.
 */

const GENERIC_FONTS = new Set([
  "inherit",
  "initial",
  "sans-serif",
  "serif",
  "monospace",
  "system-ui",
  "-apple-system",
  "blinkmacsystemfont",
  "segoe ui",
  "helvetica",
  "helvetica neue",
  "arial",
  "ui-sans-serif",
  "ui-monospace",
  "ui-serif",
  "apple color emoji",
  "segoe ui emoji",
  "segoe ui symbol",
  "noto color emoji",
  "var",
]);

/** "#abc" and "#aabbcc" as lower-case six digits; null for anything else. */
export function normalizeHex(value: string): string | null {
  const hex = value.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return `#${[...hex].map((digit) => digit + digit).join("")}`;
  }
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((part) =>
      Math.max(0, Math.min(255, Math.round(part)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Whites, blacks and greys say nothing about a brand. */
export function isNeutral(hex: string): boolean {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  return saturation < 0.18 || max < 28;
}

/** Colours in CSS (hex and rgb()), most frequent first, neutrals dropped. */
export function brandColors(css: string, limit = 5): string[] {
  const counts = new Map<string, number>();
  const add = (hex: string | null, weight = 1) => {
    if (!hex || isNeutral(hex)) return;
    counts.set(hex, (counts.get(hex) ?? 0) + weight);
  };
  for (const match of css.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    add(normalizeHex(match[0]));
  }
  for (const match of css.matchAll(
    /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/g,
  )) {
    add(rgbHex(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  // Custom properties named like brand colours weigh more than one-off uses.
  // The name is read once from where it starts and then searched: matching
  // the brand word inside the pattern backtracks for ever on long names.
  for (const match of css.matchAll(
    /(?<![\w-])--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\b/g,
  )) {
    if (/brand|primary|accent/i.test(match[1] ?? "")) {
      add(normalizeHex(match[2] ?? ""), 5);
    }
  }
  return distinctColors(
    [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex),
  ).slice(0, limit);
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/**
 * Colours in order, without near repeats: three navies a few shades apart
 * read as one brand colour.
 */
export function distinctColors(colors: string[], minDistance = 48): string[] {
  const kept: string[] = [];
  for (const color of colors) {
    const [r, g, b] = rgb(color);
    const near = kept.some((other) => {
      const [r2, g2, b2] = rgb(other);
      return Math.hypot(r - r2, g - g2, b - b2) < minDistance;
    });
    if (!near) kept.push(color);
  }
  return kept;
}

/** Code and icon faces say nothing about how a brand reads. */
const NOT_A_BRAND_FONT =
  /mono|menlo|monaco|consolas|courier|awesome|icon|glyph|symbol|emoji|dashicons|material/i;

/**
 * A family as people name it, or null when it says nothing about the brand:
 * generic families, metric fallbacks ("Inter Fallback") and CSS variables.
 * Next.js hashes ("__Inter_d65c78") read as "Inter".
 */
export function brandFontName(raw: string): string | null {
  const name = raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^_+/, "")
    .replace(/_[0-9a-f]{5,}$/i, "")
    .replace(/_/g, " ")
    .trim();
  if (!/^[A-Za-z][\w -]*$/.test(name) || /fallback/i.test(name)) return null;
  if (NOT_A_BRAND_FONT.test(name)) return null;
  return GENERIC_FONTS.has(name.toLowerCase()) ? null : name;
}

/** Font families declared in CSS, most frequent first, generic ones dropped. */
export function brandFonts(css: string, limit = 3): string[] {
  const counts = new Map<string, number>();
  const decoded = css.replace(/&quot;|&#0?34;|&#0?39;|&apos;/g, '"');
  for (const match of decoded.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
    const first = brandFontName((match[1] ?? "").split(",")[0] ?? "");
    if (first) counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([font]) => font)
    .slice(0, limit);
}

const BRAND_COLOR_ROLES = ["primary", "secondary", "tertiary"];

/**
 * The primary, secondary and tertiary entries of the front matter's
 * `colors:` block, so error and status roles (error, on-error, …) never read
 * as brand colours. Null when the file names none of them.
 */
function designMdRoleColors(content: string): string[] | null {
  // Each line ends at its newline (or the end), so lines split one way only.
  const block = content.match(
    /^colors:[ \t]*\n((?:[ \t].*(?:\n|(?![\s\S])))+)/m,
  )?.[1];
  if (!block) return null;
  const colors = BRAND_COLOR_ROLES.map((role) => {
    const value = block.match(
      new RegExp(`^[ \\t]+${role}:\\s*["']?(#[0-9a-fA-F]{3,6})\\b`, "m"),
    )?.[1];
    return value ? normalizeHex(value) : null;
  }).filter((hex): hex is string => hex !== null);
  if (colors.length === 0) return null;
  return distinctColors(colors.filter((hex) => !isNeutral(hex)));
}

/** The brand's look as a DESIGN.md states it. Empty where it says nothing. */
export interface DesignMdBrandLook {
  /**
   * Brand colours: the front matter's primary, secondary and tertiary roles,
   * else the file's most used colours; neutrals left out.
   */
  colors: string[];
  /** Named font families; generic and fallback families left out. */
  fonts: string[];
  /** The voice's adjectives, e.g. "plain, factual and confident". */
  tone: string | null;
}

/**
 * Colours, fonts and tone in a DESIGN.md: its brand colour roles, the
 * `fontFamily` entries (CSS `font-family` too), and the words after
 * "The voice is" or "Tone of voice is", when they list them.
 */
export function designMdBrandLook(content: string): DesignMdBrandLook {
  const fonts = [
    ...content.matchAll(/font-?family["']?\s*:\s*["']?([^"',;\n]+)/gi),
  ]
    .map((match) => brandFontName(match[1] ?? ""))
    .filter((font): font is string => font !== null);
  // ponytail: reads the generator's English list ("plain, factual and
  // confident"); any other wording gives no tone rather than a guess.
  const tone = content.match(
    /\bvoice is ([a-z-]+(?:, [a-z-]+)*,? and [a-z-]+)\b/i,
  )?.[1];
  return {
    colors: designMdRoleColors(content) ?? brandColors(content, 5),
    fonts: [...new Set(fonts)].slice(0, 4),
    tone: tone ?? null,
  };
}
