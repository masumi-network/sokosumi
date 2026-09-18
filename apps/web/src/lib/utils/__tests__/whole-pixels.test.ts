import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

/**
 * A fractional px is a length the display cannot draw. A 1x screen, which is
 * most Windows hardware, has no half pixel, so the browser rounds: a 1.5px
 * border lands at 1px on one edge and 2px on the opposite one, and a 0.2px
 * border rounds away to nothing. On a 2x Mac the same value looks deliberate,
 * which is why it keeps getting written.
 *
 * The ban covers lengths that resolve to a painted edge or a box dimension.
 * It does not cover continuous values, which are interpolated rather than
 * snapped and are legitimately fractional:
 *
 *   - blur and shadow radii (`blur(1.5px)`, `--chat-jump-dim-blur: 1.5px`)
 *   - translations inside a keyframe, which the compositor tweens anyway
 *   - unitless scale factors
 */
const LAYOUT_PROPS =
  "width|height|size|min-width|max-width|min-height|max-height|padding|margin|gap|row-gap|column-gap|top|right|bottom|left|inset|border|border-width|border-top-width|border-right-width|border-bottom-width|border-left-width|outline|outline-width|outline-offset";

/** `padding: 1.5px`, `border: 0.2px solid transparent`, in css and in template css. */
const CSS_FRACTIONAL = new RegExp(
  `(?:^|[;{\\s])(?:${LAYOUT_PROPS})\\s*:\\s*[^;{}]*?\\b\\d*\\.\\d+px`,
  "i",
);

/** `border: "0.2px solid transparent"` and `padding: "1.5px"` in a style object. */
const STYLE_OBJECT_FRACTIONAL =
  /\b(?:width|height|padding|margin|gap|top|right|bottom|left|inset|border|borderWidth|borderTopWidth|borderRightWidth|borderBottomWidth|borderLeftWidth|outline|outlineWidth|outlineOffset)\s*:\s*["'`][^"'`]*?\b\d*\.\d+px/;

/** Tailwind arbitrary values: `p-[1.5px]`, `border-[0.5px]`, `size-[1.5px]`. */
const TAILWIND_FRACTIONAL =
  /(?:^|[\s"'`:])-?(?:w|h|size|min-w|max-w|min-h|max-h|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|top|right|bottom|left|inset|inset-x|inset-y|border|border-x|border-y|border-t|border-r|border-b|border-l|outline|outline-offset|ring|ring-offset)-\[\d*\.\d+px\]/;

/*
 * There is deliberately no line-level exemption list. The three patterns above
 * name the properties and utilities they cover, and none of them is a blur, a
 * shadow, a filter or a transform, so a continuous value is already out of
 * scope. An exemption keyed on the whole line would instead disarm the check
 * for any line that happens to also carry `shadow-lg`, which is most of them.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (EXTENSIONS.has(path.extname(name))) out.push(full);
  }
  return out;
}

describe("whole pixels", () => {
  it("puts no fractional px on a layout or border length", () => {
    const violations: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      if (rel.startsWith("lib/clients/generated/")) continue;
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;

      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (line.trimStart().startsWith("//")) return;
        if (line.trimStart().startsWith("*")) return;
        const hit =
          CSS_FRACTIONAL.test(line) ||
          STYLE_OBJECT_FRACTIONAL.test(line) ||
          TAILWIND_FRACTIONAL.test(line);
        if (hit) violations.push(`${rel}:${index + 1}: ${line.trim()}`);
      });
    }

    expect(violations).toEqual([]);
  });
});
