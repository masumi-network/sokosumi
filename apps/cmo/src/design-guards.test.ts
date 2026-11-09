import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Guards for what the CMO.XYZ docs have locked: voice (`DESIGN.md`) and the
 * visual system (`design-system.md`): colour values in one place, one hard
 * shadow, radii from tokens, Iris/green/yellow as fills only, flat surfaces.
 */

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

interface SrcFile {
  rel: string;
  text: string;
  lines: string[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(full);
  }
  return out;
}

const FILES: SrcFile[] = walk(SRC_ROOT).map((full) => {
  const text = readFileSync(full, "utf8");
  return {
    rel: path.relative(SRC_ROOT, full).split(path.sep).join("/"),
    text,
    lines: text.split("\n"),
  };
});

const SOURCE = FILES.filter(
  (file) => /\.tsx?$/.test(file.rel) && !file.rel.includes(".test."),
);

const STYLESHEET = "app/globals.css";

/** Drawings of the networks' own UIs; exempt from the visual-system guards. */
const ALLOWLIST = ["components/phone-feeds.css", "components/showcases.css"];

/** Every stylesheet and non-test source file except the allowlist. */
const STYLED = FILES.filter(
  (file) =>
    /\.(tsx?|css)$/.test(file.rel) &&
    !file.rel.includes(".test.") &&
    !ALLOWLIST.includes(file.rel),
);

/**
 * A full-line comment carries no copy and no styles.
 * `*` starts a block-comment body and a CSS universal selector. A selector
 * (`*,`, `*::before`, `*:focus`, `* { ... }`) is not a comment, or
 * `* { outline: none }` would read as one and slip through.
 */
function isComment(line: string): boolean {
  const trimmed = line.trim();
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*/")
  ) {
    return true;
  }
  if (!trimmed.startsWith("*")) return false;
  const first = trimmed.slice(1).trimStart()[0];
  return first !== undefined && !"{:,>+~.#[".includes(first);
}

function findLines(files: SrcFile[], pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of files) {
    file.lines.forEach((line, index) => {
      if (isComment(line) || !pattern.test(line)) return;
      hits.push(`${file.rel}:${index + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe("colours", () => {
  const COLOUR_LITERAL =
    /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix|light-dark)\(/;

  it("keeps every colour literal in the :root block of globals.css", () => {
    const stylesheet = FILES.find((file) => file.rel === STYLESHEET);
    expect(stylesheet, `${STYLESHEET} is missing`).toBeDefined();

    // The `:root {` block itself, wherever it sits; a block above it is
    // checked like any other rule.
    const lines = stylesheet?.lines ?? [];
    const rootStart = lines.findIndex((line) => /^:root\b/.test(line));
    const rootEnd =
      rootStart === -1
        ? -1
        : lines.findIndex((line, index) => index > rootStart && line === "}");
    const outsideRoot = lines
      .map((line, index) => ({ line, index }))
      .filter(
        ({ index }) => rootStart === -1 || index < rootStart || index > rootEnd,
      )
      .filter(({ line }) => !isComment(line) && COLOUR_LITERAL.test(line))
      .map(({ line, index }) => `${STYLESHEET}:${index + 1}: ${line.trim()}`);

    const inSource = findLines(SOURCE, COLOUR_LITERAL);
    // Component stylesheets too: a wash in strategy-*.css is still a literal.
    const inCss = findLines(
      STYLED.filter(
        (file) => file.rel.endsWith(".css") && file.rel !== STYLESHEET,
      ),
      COLOUR_LITERAL,
    );

    expect([...outsideRoot, ...inSource, ...inCss]).toEqual([]);
  });
});

describe("typeface", () => {
  it("sets the face only through --font-sans (Inter)", () => {
    const stylesheet = FILES.find((file) => file.rel === STYLESHEET);
    const literalFamilies = (stylesheet?.lines ?? [])
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => !isComment(line) && /font-family\s*:/.test(line))
      .filter(({ line }) => !/font-family\s*:\s*var\(--font-sans\)/.test(line))
      .map(({ line, index }) => `${STYLESHEET}:${index + 1}: ${line.trim()}`);

    const inSource = findLines(SOURCE, /\bfontFamily\s*:/);

    expect(stylesheet?.text).toMatch(/--font-sans:\s*var\(--font-inter\)/);
    expect([...literalFamilies, ...inSource]).toEqual([]);
  });
});

describe("voice", () => {
  /** DESIGN.md → Voice and tone: minimal to no em dashes. */
  it("writes no em or en dash in UI copy", () => {
    expect(findLines(SOURCE, /[—–]/)).toEqual([]);
  });

  /**
   * DESIGN.md → Voice and tone: missing information is requested, never
   * hedged. These are the hedges the guide names.
   */
  it("never hedges", () => {
    const hedges = findLines(
      SOURCE,
      /\b(?:I think|I'm not sure|I am not sure|not sure if)\b/i,
    );

    expect(hedges).toEqual([]);
  });

  /**
   * DESIGN.md → Agent naming: each user names their own agent, so no screen
   * hardcodes one. "June" is the example name from the demo.
   */
  it("hardcodes no agent name", () => {
    expect(findLines(SOURCE, /\bJune\b/)).toEqual([]);
  });
});

describe("accessibility", () => {
  it("gives every image an alt attribute", () => {
    const missing: string[] = [];
    for (const file of SOURCE) {
      for (const match of file.text.matchAll(/<(?:img|Image)\b[^>]*>/g)) {
        if (/\balt=/.test(match[0])) continue;
        const line = file.text.slice(0, match.index).split("\n").length;
        const tag = match[0].startsWith("<Image") ? "<Image>" : "<img>";
        missing.push(`${file.rel}:${line}: ${tag} without alt`);
      }
    }

    expect(missing).toEqual([]);
  });

  /**
   * Interactive styles draw their own `:focus-visible` outline. Removing the
   * outline anywhere would leave a keyboard user with no focus mark.
   */
  it("never removes the focus outline", () => {
    const checked = [
      ...SOURCE,
      ...FILES.filter((file) => file.rel.endsWith(".css")),
    ];

    expect(
      findLines(checked, /outline\s*:\s*["']?(?:none\b|0(?![\d.]))/),
    ).toEqual([]);
  });
});

/** One rule per line pattern, each proven by a bad and a good sample. */
const SHADOW_DECLARATION = /\bbox-?[sS]hadow\s*:\s*["'`]?([^;"'`,}]*)/;
const SHADOW_OK =
  /^(?:none|var\(--shadow-(?:hard|iris)\)|inset 0 0 0 1px var\(--[\w-]+\))$/;
const BLUR = /\bblur\(|backdrop-filter|\bbackdropFilter/;
const RADIUS_DECLARATION =
  /\b(?:border(?:-[a-z]+)*-radius|border(?:[A-Z][a-z]+)*Radius)\s*:\s*["'`]?([^;"'`}]*)/;
const RADIUS_OK =
  /^(?:var\(--radius-(?:mark|control|card|panel)\)|50%|0|inherit)$/;
const IRIS_TEXT =
  /(?<![\w-])(?:color|stroke|text-decoration-color|border[\w-]*|outline[\w-]*|borderColor|outlineColor)\s*:[^;]*var\(--primary(?:-hover)?\)/;
const SIGNAL_TEXT = /(?<![\w-])(?:color|stroke)\s*:[^;]*var\(--(?:ok|warn)\)/;
const GRADIENT = /gradient\(/;
const FONT_SIZE_DECLARATION = /(?<![\w-])font-size\s*:\s*([^;}]*)/;
/** The type scale's sizes in rem (design-system.md), plus sizes relative to the parent. */
const SCALE_SIZES = new Set([
  "4.5rem",
  "2.25rem",
  "1.75rem",
  "1.5rem",
  "1rem",
  "0.875rem",
  "0.75rem",
  "0.6875rem",
]);
const FONT_SIZE_OK = /^(?:inherit|\d*\.?\d+em)$/;

function badShadow(line: string): boolean {
  const value = SHADOW_DECLARATION.exec(line)?.[1]?.trim();
  return value !== undefined && !SHADOW_OK.test(value);
}

function badFontSize(line: string): boolean {
  const value = FONT_SIZE_DECLARATION.exec(line)?.[1]?.trim();
  if (value === undefined) return false;
  const sizes = value.startsWith("clamp(")
    ? (value.match(/\d*\.?\d+rem/g) ?? [])
    : [value];
  return !sizes.every(
    (size) => SCALE_SIZES.has(size) || FONT_SIZE_OK.test(size),
  );
}

function badRadius(line: string): boolean {
  const value = RADIUS_DECLARATION.exec(line)?.[1]?.trim();
  return (
    value !== undefined &&
    !value.split(/\s+/).every((part) => RADIUS_OK.test(part))
  );
}

/**
 * Every stroke is 1px (design-system.md, rule 1). A border wider than that,
 * anywhere, including the drawings of networks' UIs, breaks the system; focus
 * rings are outlines, not borders, and stay 2px for keyboard users.
 */
const BORDER_WIDTH =
  /(?<![\w-])border(?:-(?:top|right|bottom|left))?(?:-width)?\s*:[^;]*?\b(\d+(?:\.\d+)?)px/;

function thickBorder(line: string): boolean {
  if (/radius/.test(line)) return false;
  const width = BORDER_WIDTH.exec(line)?.[1];
  return width !== undefined && Number(width) > 1;
}

describe("strokes", () => {
  it("draws every border 1px", () => {
    const css = FILES.filter((file) => file.rel.endsWith(".css"));
    expect(
      findLines(css, BORDER_WIDTH).filter((hit) => thickBorder(hit)),
    ).toEqual([]);
  });

  it("flags a thick border and passes 1px, 0 and radius", () => {
    expect(thickBorder("  border: 2px solid var(--line);")).toBe(true);
    expect(thickBorder("  border-top: 6px solid var(--surface);")).toBe(true);
    expect(thickBorder("  border-left-width: 3px;")).toBe(true);
    expect(thickBorder("  border: 1px solid var(--line);")).toBe(false);
    expect(thickBorder("  border-radius: 14px;")).toBe(false);
    expect(thickBorder("  border: 0;")).toBe(false);
  });
});

describe("visual system", () => {
  it("allows one hard shadow and no blur", () => {
    expect(
      findLines(STYLED, /box-?[sS]hadow/).filter((hit) => badShadow(hit)),
    ).toEqual([]);
    expect(findLines(STYLED, BLUR)).toEqual([]);
  });

  it("takes every radius from the tokens", () => {
    expect(
      findLines(STYLED, RADIUS_DECLARATION).filter((hit) => badRadius(hit)),
    ).toEqual([]);
  });

  it("sets type only in the scale's sizes", () => {
    expect(
      findLines(
        STYLED.filter((file) => file.rel.endsWith(".css")),
        FONT_SIZE_DECLARATION,
      ).filter((hit) => badFontSize(hit)),
    ).toEqual([]);
  });

  it("uses Iris as a fill, never as text or a line", () => {
    expect(findLines(STYLED, IRIS_TEXT)).toEqual([]);
  });

  it("uses green and yellow as fills, never as text", () => {
    expect(findLines(STYLED, SIGNAL_TEXT)).toEqual([]);
  });

  it("stays flat: no gradients", () => {
    expect(findLines(STYLED, GRADIENT)).toEqual([]);
  });

  describe("matchers", () => {
    it("flags a blurred shadow and passes the hard one", () => {
      expect(badShadow("  box-shadow: 0 1px 2px var(--border);")).toBe(true);
      expect(badShadow('boxShadow: "0 0 0 3px var(--surface)"')).toBe(true);
      expect(badShadow("  box-shadow: var(--shadow-hard);")).toBe(false);
      expect(badShadow("  box-shadow: var(--shadow-iris);")).toBe(false);
      expect(badShadow("  box-shadow: inset 0 0 0 1px var(--line);")).toBe(
        false,
      );
      expect(badShadow("  box-shadow: none;")).toBe(false);
    });

    it("flags blur and passes a plain filter", () => {
      expect(BLUR.test("  backdrop-filter: blur(12px);")).toBe(true);
      expect(BLUR.test("  filter: blur(2px);")).toBe(true);
      expect(BLUR.test("  filter: grayscale(1);")).toBe(false);
    });

    it("flags a size off the type scale and passes the scale's own", () => {
      expect(badFontSize("  font-size: 0.8125rem;")).toBe(true);
      expect(badFontSize("  font-size: 17px;")).toBe(true);
      expect(badFontSize("  font-size: clamp(2rem, 5vw, 2.75rem);")).toBe(true);
      expect(badFontSize("  font-size: 0.875rem;")).toBe(false);
      expect(badFontSize("  font-size: clamp(2.25rem, 6vw, 4.5rem);")).toBe(
        false,
      );
      expect(badFontSize("  font-size: 0.8em;")).toBe(false);
    });

    it("flags a literal radius and passes a token", () => {
      expect(badRadius("  border-radius: 8px;")).toBe(true);
      expect(badRadius("  border-top-left-radius: 4px;")).toBe(true);
      expect(badRadius('borderRadius: "12px"')).toBe(true);
      expect(badRadius("  border-radius: var(--radius-card);")).toBe(false);
      expect(badRadius("  border-radius: 999px;")).toBe(true);
      expect(badRadius("  border-radius: 50%;")).toBe(false);
      expect(
        badRadius(
          "  border-radius: 0 0 var(--radius-card) var(--radius-card);",
        ),
      ).toBe(false);
    });

    it("flags Iris as text or a line and passes it as a fill", () => {
      expect(IRIS_TEXT.test("  color: var(--primary);")).toBe(true);
      expect(IRIS_TEXT.test("  border: 1px solid var(--primary);")).toBe(true);
      expect(IRIS_TEXT.test("  outline-color: var(--primary-hover);")).toBe(
        true,
      );
      expect(IRIS_TEXT.test("  background: var(--primary);")).toBe(false);
      expect(IRIS_TEXT.test("  color: var(--primary-foreground);")).toBe(false);
    });

    it("flags green and yellow as text and passes them as fills", () => {
      expect(SIGNAL_TEXT.test("  color: var(--ok);")).toBe(true);
      expect(SIGNAL_TEXT.test("  stroke: var(--warn);")).toBe(true);
      expect(SIGNAL_TEXT.test("  background: var(--ok);")).toBe(false);
      expect(SIGNAL_TEXT.test("  background-color: var(--warn);")).toBe(false);
    });

    it("flags a gradient and passes a flat fill", () => {
      expect(GRADIENT.test("  background: linear-gradient(red, blue);")).toBe(
        true,
      );
      expect(GRADIENT.test("  background: var(--surface);")).toBe(false);
    });
  });
});
