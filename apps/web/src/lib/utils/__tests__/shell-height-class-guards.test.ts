import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// File lives at apps/web/src/lib/utils/__tests__ → ../../.. = apps/web/src
const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const ROOT = path.resolve(SRC, "..");

/**
 * Header-offset shells must use rem (`4rem` / `6rem`), not fixed px.
 * Match Tailwind tight form, CSS-spaced calc, and Tailwind underscore-space form.
 *
 * Viewport-height shells must use `dvh`, never `svh`. In iOS home-screen web
 * apps WebKit reports `svh` off by the status-bar height in both status-bar
 * styles (874 vs an 812 layout viewport with the default style, 812 vs 874
 * with black-translucent), which made the document 62px taller than the
 * screen and let the whole room, composer included, scroll. `dvh` matched
 * the layout viewport in every mode measured (Safari, both standalone styles).
 */
const FORBIDDEN_PATTERNS = [
  { label: "100dvh-64px", re: /100dvh[\s_]*-[\s_]*64px/ },
  { label: "100dvh-96px", re: /100dvh[\s_]*-[\s_]*96px/ },
  { label: "svh unit", re: /(\d|-)svh\b/ },
] as const;

const EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

interface ScanFile {
  rel: string;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/** Pure scan over preloaded files — used for repo walk and hit/miss fixtures. */
function findForbiddenHeaderOffsetHits(files: ScanFile[]): string[] {
  const hits: string[] = [];
  for (const { rel, text } of files) {
    // Self documents the banned patterns; skip.
    if (rel.endsWith("shell-height-class-guards.test.ts")) continue;

    for (const { label, re } of FORBIDDEN_PATTERNS) {
      if (!re.test(text)) continue;
      hits.push(`${rel}: contains ${label}`);
    }
  }
  return hits;
}

function loadSrcTree(): ScanFile[] {
  return walk(SRC).map((file) => ({
    rel: path.relative(ROOT, file).split(path.sep).join("/"),
    text: fs.readFileSync(file, "utf8"),
  }));
}

describe("shell height class guards", () => {
  it("detects tight, spaced, and underscore calc forms", () => {
    const hits = findForbiddenHeaderOffsetHits([
      { rel: "clean.tsx", text: 'className="h-[calc(100dvh-4rem)]"' },
      {
        rel: "tight.tsx",
        text: 'className="h-[calc(100dvh-64px)]"',
      },
      {
        rel: "spaced.css",
        text: "height: calc(100dvh - 64px);",
      },
      {
        rel: "underscore.tsx",
        text: 'className="h-[calc(100dvh_-_96px)]"',
      },
      { rel: "svh-bare.tsx", text: 'className="min-h-svh max-h-svh"' },
      { rel: "svh-calc.tsx", text: 'className="h-[calc(100svh-4rem)]"' },
      { rel: "svh-percent.tsx", text: 'className="max-h-[90svh]"' },
    ]);

    expect(hits).toEqual([
      "tight.tsx: contains 100dvh-64px",
      "spaced.css: contains 100dvh-64px",
      "underscore.tsx: contains 100dvh-96px",
      "svh-bare.tsx: contains svh unit",
      "svh-calc.tsx: contains svh unit",
      "svh-percent.tsx: contains svh unit",
    ]);
  });

  it("returns no hits for clean fixtures", () => {
    expect(
      findForbiddenHeaderOffsetHits([
        { rel: "a.tsx", text: "h-[calc(100dvh-4rem)]" },
        { rel: "b.tsx", text: "lg:h-[calc(100dvh-6rem)]" },
        { rel: "c.tsx", text: "w-svw max-w-dvw" },
      ]),
    ).toEqual([]);
  });

  it("bans px header offsets and svh units in product shells", () => {
    const hits = findForbiddenHeaderOffsetHits(loadSrcTree());
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
