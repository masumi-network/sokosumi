import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/**
 * Guards the three rules in `.cursor/rules/color-tokens.mdc`. Each one is a
 * separate test so a failure names which rule broke.
 *
 * The opacity rule is now absolute. It used to cover only the ramps that had
 * solid steps to move to, because the neutral tokens were still faded by hand
 * in roughly 700 places. Those are all converted, so a modifier on any colour
 * utility is a bug from here on. Where a surface genuinely has to show what
 * sits behind it, the token carries the alpha: `--overlay`, `--surface-glass`,
 * `--surface-sticky`, `--scrim`.
 */

const EXTENSIONS = new Set([".ts", ".tsx"]);

const TAILWIND_PALETTE = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
].join("|");

/**
 * `ring-offset` comes before `ring` because the alternation is ordered: with
 * `ring` first, `ring-offset-white` never reaches the palette branch and the
 * raw colour survives.
 */
const COLOR_UTILITIES =
  "bg|text|ring-offset|ring|inset-ring|border|outline|divide|fill|stroke|shadow|decoration|accent|caret|placeholder|from|via|to";

const RAW_PALETTE = new RegExp(
  `\\b(?:${COLOR_UTILITIES})-(?:(?:${TAILWIND_PALETTE})-\\d{2,3}|black|white)\\b`,
);

const COLOR_UTILITIES_NO_TEXT = COLOR_UTILITIES.split("|")
  .filter((utility) => utility !== "text")
  .join("|");

/**
 * `text-sm/6` sets a line height, not an opacity, so the font-size names are
 * the one thing a colour utility prefix can carry a slash for legitimately.
 * The exemption is scoped to `text-`: `shadow` takes the same size words and
 * a real opacity modifier, so an unscoped lookahead let `shadow-lg/25`
 * through.
 */
const FONT_SIZES = "xs|sm|base|lg|xl|[2-9]xl";

/**
 * The tail is a negative lookahead, not `\b`. A word boundary after `]` needs
 * a word character next, which a class name never has, so the arbitrary-value
 * branch was unreachable and `bg-primary/[0.04]` — the rule's own headline
 * example — compiled with the guard green.
 */
const TOKEN_OPACITY = new RegExp(
  `\\b(?:text-(?!(?:${FONT_SIZES})/)|(?:${COLOR_UTILITIES_NO_TEXT})-)[a-z0-9-]+/(?:\\[[0-9.]+%?\\]|\\d{1,3})(?![\\w.])`,
);

/**
 * A hex only counts when it is quote-delimited or inside an arbitrary Tailwind
 * value. A bare `#3617` in prose is an issue number, not a color.
 */
const COLOR_LITERAL =
  /(?:["'`]#[0-9a-fA-F]{3,8}["'`]|-\[#[0-9a-fA-F]{3,8}|\brgba?\(\s*\d|\bhsla?\(\s*\d|\boklch\(\s*[\d.])/;

/**
 * Third-party brand marks and anything that hands a concrete color string to a
 * canvas, an OS surface, or a color picker. None of these can read a CSS
 * custom property.
 */
const LITERAL_ALLOWLIST = new Set([
  // Brand marks belong to the providers, not to us.
  "components/social-icons.tsx",
  // The user picks the value; these are the swatches and the empty state.
  "components/ui/color-picker.tsx",
  "components/job-input/inputs/color-input.tsx",
  // Renders when the stylesheet itself failed to load.
  "app/global-error.tsx",
  // `srcdoc` for an isolated iframe, which does not inherit our tokens.
  "components/ui/image-viewer.tsx",
  // Read by the OS, not by CSS.
  "app/manifest.ts",
  "components/pwa/apple-pwa-head.tsx",
  // A canvas library needs a resolved string; it reads `--primary` first and
  // only falls back to the literal.
  "app/(app)/personal-assistant/components/chat/thinking-orb.tsx",
  // Canvas painters. Both build a concrete string for a 2D context.
  "lib/aurora-orb.ts",
  "lib/job-input/form.ts",
]);

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

function relativePath(file: string): string {
  return path.relative(SRC_ROOT, file).split(path.sep).join("/");
}

/** This file spells out every banned pattern, so it cannot scan itself. */
const SELF = "lib/utils/__tests__/color-tokens.test.ts";

function findViolations(
  pattern: RegExp,
  skip: (rel: string) => boolean = () => false,
): string[] {
  const violations: string[] = [];
  for (const file of walk(SRC_ROOT)) {
    const rel = relativePath(file);
    if (rel === SELF || skip(rel)) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (pattern.test(line)) {
          violations.push(`${rel}:${index + 1}: ${line.trim()}`);
        }
      });
  }
  return violations;
}

describe("color tokens", () => {
  it("uses no raw Tailwind palette colors", () => {
    // No allowlist here. LITERAL_ALLOWLIST exempts files that must hand a
    // concrete colour string to something that cannot read a custom property;
    // none of them has any reason to write a palette class.
    const violations = findViolations(RAW_PALETTE);

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("puts no opacity modifier on any color utility", () => {
    const violations = findViolations(TOKEN_OPACITY);

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("has no color literal in a component", () => {
    const violations = findViolations(
      COLOR_LITERAL,
      (rel) => LITERAL_ALLOWLIST.has(rel) || rel.includes(".test."),
    );

    expect(violations, violations.join("\n")).toEqual([]);
  });

  /**
   * A fourth rule, about the stylesheet rather than the call sites. Tailwind
   * builds a utility only for a token `@theme inline` bridges, and it inlines
   * the bridge, so a name with no bridge emits nothing at all and a bridge
   * with no value emits `var(--missing)`, which falls back to `currentColor`.
   * Both fail in silence with every test green. This stack shipped one of
   * each before anyone noticed.
   */
  describe("the stylesheet", () => {
    const stylesheet = readFileSync(
      path.join(SRC_ROOT, "app/globals.css"),
      "utf8",
    );

    function block(selector: string): string {
      const start = stylesheet.indexOf(`\n${selector} {`);
      const body = stylesheet.slice(start);
      return body.slice(0, body.indexOf("\n}\n"));
    }

    function definitions(selector: string): Set<string> {
      return new Set(
        [...block(selector).matchAll(/^ {2}(--[a-z0-9-]+):/gm)].map(
          (match) => match[1],
        ),
      );
    }

    const light = definitions(":root");
    const dark = definitions(".dark");

    it("defines every bridged token", () => {
      const bridges = [
        ...block("@theme inline").matchAll(
          /^ {2}--color-[a-z0-9-]+: var\((--[a-z0-9-]+)\);/gm,
        ),
      ].map((match) => match[1]);

      const dangling = bridges.filter(
        (token) => !light.has(token) && !dark.has(token),
      );

      expect(dangling, dangling.join(", ")).toEqual([]);
    });

    it("defines the same tokens in both themes", () => {
      const lightOnly = [...light].filter((token) => !dark.has(token));
      const darkOnly = [...dark].filter((token) => !light.has(token));

      expect(
        { lightOnly, darkOnly },
        "a token defined in one theme only takes the other theme's value",
      ).toEqual({ lightOnly: [], darkOnly: [] });
    });
  });
});
