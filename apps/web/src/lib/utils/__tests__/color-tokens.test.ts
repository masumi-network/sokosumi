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
 * Scope note: rule 2 covers the ramps that have real `-tertiary` /
 * `-quaternary` / `-quinary` steps to move to. Opacity on the neutral tokens
 * (`muted-foreground/70`, `border/50`, …) is still in the codebase in roughly
 * 140 places and is tracked as debt, so this does not fail on it yet. Widen
 * `OPACITY_TOKENS` as those ramps land.
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

const COLOR_UTILITIES =
  "bg|text|border|ring|inset-ring|outline|divide|fill|stroke|shadow|decoration|accent|caret|placeholder|from|via|to";

const RAW_PALETTE = new RegExp(
  `\\b(?:${COLOR_UTILITIES})-(?:${TAILWIND_PALETTE})-\\d{2,3}\\b`,
);

/** Token families whose solid steps exist, so an opacity modifier is a bug. */
const OPACITY_TOKENS = "semantic-[a-z-]+|status-[a-z-]+|risk-[a-z-]+|ring";

const TOKEN_OPACITY = new RegExp(
  `\\b(?:${COLOR_UTILITIES})-(?:${OPACITY_TOKENS})/\\d+\\b`,
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
    const violations = findViolations(RAW_PALETTE, (rel) =>
      LITERAL_ALLOWLIST.has(rel),
    );

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("puts no opacity modifier on a semantic, status, or risk token", () => {
    const violations = findViolations(TOKEN_OPACITY);

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("has no color literal in a component", () => {
    const violations = findViolations(
      COLOR_LITERAL,
      (rel) =>
        LITERAL_ALLOWLIST.has(rel) ||
        // Canvas painters and color helpers build concrete strings by design.
        rel.startsWith("lib/") ||
        rel.includes(".test."),
    );

    expect(violations, violations.join("\n")).toEqual([]);
  });
});
