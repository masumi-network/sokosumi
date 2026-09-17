import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/**
 * A rule that spans the view escapes the app's horizontal gutter with a
 * negative margin. There is exactly one gutter to escape: `p-4` on
 * `main[data-app-main]` in `authenticated-app-frame.tsx`. So there is exactly
 * one correct value, `-mx-4`, and any other number is a bug you can see.
 *
 * `-mx-6` was the old habit, from pages that added `px-2` of their own on top
 * of the shell. It measured right on those two pages and overshot by 8px
 * everywhere else. Pages no longer add a second gutter, so 24px is now wrong
 * everywhere.
 *
 * This checks the value, not whether a given rule should bleed at all. A
 * centred column inside a `max-w-*` wrapper has its own padding and no rule
 * crossing the view, and is out of scope.
 */
const CANONICAL_BLEED = "-mx-4";

/** A negative horizontal margin on the same element as a painted rule. */
const BLEEDING_RULE =
  /className=\{?\s*(?:cn\()?\s*["'`][^"'`]*(?:\bborder-[tbxy]\b|\bborder-border\b)[^"'`]*["'`]/;
const NEGATIVE_MX = /(?:^|[\s"'`])(-mx-(?:\d+(?:\.\d+)?|\[[^\]]+\]))/g;

const EXTENSIONS = new Set([".tsx"]);

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

describe("full-bleed rules", () => {
  it("escapes the one app gutter, never more and never less", () => {
    const violations: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      if (rel.startsWith("lib/clients/generated/")) continue;
      if (rel.endsWith(".test.tsx")) continue;

      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!BLEEDING_RULE.test(line)) return;
        for (const [, value] of line.matchAll(NEGATIVE_MX)) {
          if (value === CANONICAL_BLEED) continue;
          violations.push(`${rel}:${index + 1}: ${value} in ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});

/**
 * The other half of the same invariant. `-mx-4` reaches the edge only while
 * `main` holds the only gutter, so a page that wraps itself in a second one
 * silently shortens every rule below it by that much.
 *
 * Seven roots still did. `drive-page-client.tsx` and `tasks-loading-view.tsx`
 * each paired a `px-2` root with an `-mx-4` rule, so the rule stopped 8px
 * short on both sides. The skeleton roots were worse than cosmetic: the tasks
 * page had already dropped its `px-2` and its skeleton had not, so the content
 * jumped 8px sideways the moment the page loaded.
 *
 * The scan reads route files and the page-level views they render, and looks
 * for a full-width wrapper that also pads horizontally. Its blind spot is
 * spelling. It reads `px-*` only, because `pl-8` on a full-width search input
 * is an icon inset rather than a gutter, and it reads the literal `w-full`, so
 * a root written as `min-w-full` or assembled from a variable, or a page view
 * named outside these patterns, is invisible to it. It catches the shape that
 * actually occurred.
 */
const PAGE_ROOT_FILES =
  /(?:^|\/)(?:page|loading)\.tsx$|-page-client\.tsx$|-loading-view\.tsx$|-skeleton(?:-host)?\.tsx$/;
const SECOND_GUTTER = /\bw-full\s+(px-(?:\d+(?:\.\d+)?|\[[^\]]+\]))/;

describe("page gutters", () => {
  it("leaves the one gutter to the app shell", () => {
    const violations: string[] = [];

    for (const file of walk(path.join(SRC_ROOT, "app", "(app)"))) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      if (rel.endsWith(".test.tsx")) continue;
      if (!PAGE_ROOT_FILES.test(rel)) continue;

      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          const match = line.match(SECOND_GUTTER);
          if (match) violations.push(`${rel}:${index + 1}: ${match[0]}`);
        });
    }

    expect(violations).toEqual([]);
  });
});
