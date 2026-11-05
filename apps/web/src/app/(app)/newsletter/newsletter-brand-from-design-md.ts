import { z } from "zod";

import type { NewsletterSettingsValues } from "@/lib/schemas/newsletter";

import type { NewsletterFont } from "./newsletter-design-fields";

type ColorField =
  | "primaryColor"
  | "accentColor"
  | "backgroundColor"
  | "buttonTextColor";

/** The Brand fields a DESIGN.md can fill; a field it does not name stays unset. */
export type NewsletterDesignMdBrand = Partial<
  Pick<NewsletterSettingsValues, ColorField | "fontFamily" | "logoUrl">
>;

// Not after a word, slash or entity: `page#abc`, `/#abc` and `&#123;` are not colors.
const HEX_COLOR = /(?<![\w/#&])#([\da-f]{6}|[\da-f]{3})\b/gi;
const FONT_DECLARATION =
  /\b(?:font|typeface)[\w-]*(?:[ \t]+family)?[*_`"' \t]*[:=|][*_`"' \t]*([^\n;]+)/gi;
const HTTPS_URL = /https:\/\/[^\s)"'<>\]`|]+/g;
const LOGO_LABEL =
  /^\W*(?:[\w-]+\s+)?logo(?:[\s_-]?url)?s?[^\w\n]*[:=|][^\w\n]*(https:\/\/[^\s)"'<>\]`|]+)/i;
const LOGO_IMAGE = /!\[[^\]\n]*logo[^\]\n]*\]\((https:\/\/[^\s)]+)/i;
/** The form only takes an https logo. */
const LOGO_URL = z.url({ protocol: /^https$/ }).max(2048);

/** A front matter component's fills belong to that component, not to the page. */
const COMPONENTS_BLOCK = /^components:[^\n]*\n(?:[ \t]+[^\n]*\n?)*/m;

/** A label longer than this is a sentence that happens to mention a role. */
const MAX_LABEL_WORDS = 6;

/** Never a brand's own color, labeled or not. */
const NOT_BRAND_WORDS = new Set([
  "on",
  "foreground",
  "fg",
  "text",
  "border",
  "outline",
  "ring",
  "shadow",
  "background",
  "bg",
  "surface",
  "card",
  "error",
  "danger",
  "destructive",
  "warning",
  "success",
  "info",
  "hover",
  "active",
  "pressed",
  "focus",
  "disabled",
]);
/** A shade of a role rather than the role itself: `primary-light`, `accent-500`. */
const SHADE_WORD =
  /^(?:\d+|light|lighter|dark|darker|muted|subtle|soft|dim|variant|container|tint|shade|gradient)$/;
const NOT_THE_PAGE_WORDS = new Set([
  "button",
  "card",
  "surface",
  "hero",
  "header",
  "footer",
  "nav",
  "sidebar",
  "input",
  "on",
  "foreground",
  "fg",
]);

const CODE_OR_ICON_FONT = /mono|code|courier|icon|awesome|emoji|symbol/;
/** The name a font starts with, and the allowed font closest to it. */
const FONT_ALIASES: [string, NewsletterFont][] = [
  ["arial", "Arial"],
  ["helvetica", "Helvetica"],
  ["georgia", "Georgia"],
  ["verdana", "Verdana"],
  ["trebuchet", "Trebuchet MS"],
  ["times", "Times New Roman"],
  ["inter", "Arial"],
  ["roboto", "Arial"],
  ["system-ui", "Arial"],
  ["-apple-system", "Arial"],
  ["blinkmacsystemfont", "Arial"],
  ["segoe ui", "Arial"],
  ["sf pro", "Arial"],
  ["merriweather", "Georgia"],
  ["playfair", "Georgia"],
  ["lora", "Georgia"],
  ["garamond", "Georgia"],
  ["baskerville", "Georgia"],
];

/** Expand a 3-digit hex to 6 digits, lowercased. */
function normalizeHex(digits: string): string {
  const hex = digits.toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex}`;
}

function rgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** Whites, blacks and greys say nothing about a brand. */
function isNeutral(hex: string): boolean {
  const channels = rgb(hex);
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  return max < 28 || (max - min) / max < 0.18;
}

/** Three navies a few shades apart read as one brand color. */
function isNearColor(a: string, b: string): boolean {
  const [r, g, bl] = rgb(a);
  const [r2, g2, bl2] = rgb(b);
  return Math.hypot(r - r2, g - g2, bl - bl2) < 48;
}

function labelWords(text: string): string[] {
  return (
    text
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .match(/[a-z\d]+/g) ?? []
  );
}

/** The Brand field a color's label clearly names, if any. */
function colorField(words: string[]): ColorField | null {
  if (words.length > MAX_LABEL_WORDS) return null;
  const has = (...names: string[]) =>
    names.some((name) => words.includes(name));
  // Buttons are accent-filled, so `on-primary` says nothing about their label.
  if (
    (has("button") && has("text", "label", "foreground")) ||
    (has("accent") && has("on", "foreground", "fg"))
  ) {
    return "buttonTextColor";
  }
  if (words.some((word) => SHADE_WORD.test(word))) return null;
  if (has("background", "bg")) {
    return words.some((word) => NOT_THE_PAGE_WORDS.has(word))
      ? null
      : "backgroundColor";
  }
  if (words.some((word) => NOT_BRAND_WORDS.has(word))) return null;
  if (has("accent")) return "accentColor";
  return has("primary", "brand") ? "primaryColor" : null;
}

/**
 * Colors the DESIGN.md labels, then its first distinct non-neutral colors for a
 * primary or accent it does not label. A labeled neutral is kept: a black
 * primary is a choice.
 */
function colorsFromDesignMd(
  lines: string[],
): Pick<NewsletterDesignMdBrand, ColorField> {
  const labeled: Partial<Record<ColorField, string>> = {};
  const unlabeled: string[] = [];
  for (const line of lines) {
    const matches = [...line.matchAll(HEX_COLOR)];
    matches.forEach((match, index) => {
      const previous = matches[index - 1];
      const before = line.slice(
        previous ? previous.index + previous[0].length : 0,
        match.index,
      );
      const after = line.slice(
        match.index + match[0].length,
        matches[index + 1]?.index,
      );
      const wordsBefore = labelWords(before);
      const words = wordsBefore.length ? wordsBefore : labelWords(after);
      const hex = normalizeHex(match[1] ?? "");
      const field = colorField(words);
      if (field) labeled[field] ??= hex;
      else if (!words.some((word) => NOT_BRAND_WORDS.has(word))) {
        unlabeled.push(hex);
      }
    });
  }

  const kept = [labeled.primaryColor, labeled.accentColor].filter(
    (color) => color !== undefined,
  );
  const distinct: string[] = [];
  for (const hex of unlabeled) {
    if (isNeutral(hex)) continue;
    if ([...kept, ...distinct].some((color) => isNearColor(color, hex))) {
      continue;
    }
    distinct.push(hex);
  }

  const primaryColor = labeled.primaryColor ?? distinct.shift();
  const accentColor = labeled.accentColor ?? distinct.shift();
  return {
    ...(primaryColor ? { primaryColor } : {}),
    ...(accentColor ? { accentColor } : {}),
    ...(labeled.backgroundColor
      ? { backgroundColor: labeled.backgroundColor }
      : {}),
    ...(labeled.buttonTextColor
      ? { buttonTextColor: labeled.buttonTextColor }
      : {}),
  };
}

function allowedFont(family: string): NewsletterFont | null {
  const name = family
    .replace(/[*_`"'()]/g, " ")
    .trim()
    .toLowerCase();
  if (!name || CODE_OR_ICON_FONT.test(name)) return null;
  const alias = FONT_ALIASES.find(([prefix]) => name.startsWith(prefix));
  if (alias) return alias[1];
  // "Open Sans" and "sans-serif" read as a sans; "Noto Serif" as a serif.
  if (/\bsans\b/.test(name)) return "Arial";
  return /\bserif\b/.test(name) ? "Georgia" : null;
}

/** The first declared font, or fallback in its stack, an email can use. */
function fontFromDesignMd(markdown: string): NewsletterFont | null {
  for (const match of markdown.matchAll(FONT_DECLARATION)) {
    for (const family of (match[1] ?? "").split(/[,|]/)) {
      const font = allowedFont(family);
      if (font) return font;
    }
  }
  return null;
}

function validLogoUrl(url: string | null | undefined): string | null {
  const cleaned = url?.trim().replace(/[.,;:]+$/, "");
  return cleaned && LOGO_URL.safeParse(cleaned).success ? cleaned : null;
}

/**
 * A line's logo: labeled, an image named as one, or a URL that says so. A
 * logo merely mentioned beside a link is not one, or a guidelines page would
 * end up as the email's image.
 */
function logoFromLine(line: string): string | null {
  const named = line.match(LOGO_LABEL)?.[1] ?? line.match(LOGO_IMAGE)?.[1];
  const url =
    named ??
    [...line.matchAll(HTTPS_URL)].find((match) => /logo/i.test(match[0]))?.[0];
  return validLogoUrl(url);
}

/**
 * Newsletter Brand values read from a DESIGN.md: only what it names, so
 * applying them leaves every other field as it is. `extras.logoUrl` (the
 * owner's logo) is used when the markdown names no logo.
 */
export function newsletterBrandFromDesignMd(
  markdown: string,
  extras?: { logoUrl?: string | null },
): NewsletterDesignMdBrand {
  const content = markdown.replace(COMPONENTS_BLOCK, "");
  const lines = content.split(/\r?\n/);
  const fontFamily = fontFromDesignMd(content);
  const logoUrl =
    lines.map(logoFromLine).find((url) => url !== null) ??
    validLogoUrl(extras?.logoUrl);
  return {
    ...colorsFromDesignMd(lines),
    ...(fontFamily ? { fontFamily } : {}),
    ...(logoUrl ? { logoUrl } : {}),
  };
}
