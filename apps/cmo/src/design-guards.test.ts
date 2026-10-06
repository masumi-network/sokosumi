import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Guards for what the CMO.XYZ style guide (`apps/cmo/DESIGN.md`) has locked:
 * voice and typeface. Colours, logo and shapes are still open, so the colour
 * rule only keeps every value in one place, the `:root` block of
 * `globals.css`, where the brand will replace them in a single edit.
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

/** A line that is only a comment carries no copy and no styles. */
function isComment(line: string): boolean {
  return /^\s*(\/\/|\/?\*)/.test(line);
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

    const rootEnd = stylesheet?.lines.findIndex((line) => line === "}") ?? -1;
    const outsideRoot = (stylesheet?.lines ?? [])
      .map((line, index) => ({ line, index }))
      .filter(({ index }) => index > rootEnd)
      .filter(({ line }) => !isComment(line) && COLOUR_LITERAL.test(line))
      .map(({ line, index }) => `${STYLESHEET}:${index + 1}: ${line.trim()}`);

    const inSource = findLines(SOURCE, COLOUR_LITERAL);

    expect([...outsideRoot, ...inSource]).toEqual([]);
  });
});

describe("typeface", () => {
  it("sets the face only through --font-sans (PP Mori)", () => {
    const stylesheet = FILES.find((file) => file.rel === STYLESHEET);
    const literalFamilies = (stylesheet?.lines ?? [])
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /font-family\s*:/.test(line))
      .filter(({ line }) => !/font-family\s*:\s*var\(--font-sans\)/.test(line))
      .map(({ line, index }) => `${STYLESHEET}:${index + 1}: ${line.trim()}`);

    const inSource = findLines(SOURCE, /\bfontFamily\s*:/);

    expect(stylesheet?.text).toMatch(/--font-sans:\s*"PP Mori"/);
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
      for (const match of file.text.matchAll(/<img\b[^>]*>/g)) {
        if (/\balt=/.test(match[0])) continue;
        const line = file.text.slice(0, match.index).split("\n").length;
        missing.push(`${file.rel}:${line}: <img> without alt`);
      }
    }

    expect(missing).toEqual([]);
  });

  /**
   * Interactive styles draw their own `:focus-visible` outline. Removing the
   * outline anywhere would leave a keyboard user with no focus mark.
   */
  it("never removes the focus outline", () => {
    const stylesheet = FILES.filter((file) => file.rel === STYLESHEET);

    expect(findLines(stylesheet, /outline\s*:\s*(?:none|0)\b/)).toEqual([]);
  });
});
