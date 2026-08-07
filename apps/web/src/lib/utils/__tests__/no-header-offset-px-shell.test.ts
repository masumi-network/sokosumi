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
 */
const FORBIDDEN_PATTERNS = [
  { label: "100svh-64px", re: /100svh[\s_]*-[\s_]*64px/ },
  { label: "100svh-96px", re: /100svh[\s_]*-[\s_]*96px/ },
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
    if (rel.endsWith("no-header-offset-px-shell.test.ts")) continue;

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

describe("no header-offset px shells", () => {
  it("detects tight, spaced, and underscore calc forms", () => {
    const hits = findForbiddenHeaderOffsetHits([
      { rel: "clean.tsx", text: 'className="h-[calc(100svh-4rem)]"' },
      {
        rel: "tight.tsx",
        text: 'className="h-[calc(100svh-64px)]"',
      },
      {
        rel: "spaced.css",
        text: "height: calc(100svh - 64px);",
      },
      {
        rel: "underscore.tsx",
        text: 'className="h-[calc(100svh_-_96px)]"',
      },
    ]);

    expect(hits).toEqual([
      "tight.tsx: contains 100svh-64px",
      "spaced.css: contains 100svh-64px",
      "underscore.tsx: contains 100svh-96px",
    ]);
  });

  it("returns no hits for clean fixtures", () => {
    expect(
      findForbiddenHeaderOffsetHits([
        { rel: "a.tsx", text: "h-[calc(100svh-4rem)]" },
        { rel: "b.tsx", text: "lg:h-[calc(100svh-6rem)]" },
      ]),
    ).toEqual([]);
  });

  it("bans product 100svh-64px / 100svh-96px (use 4rem / 6rem for Header h-16)", () => {
    const hits = findForbiddenHeaderOffsetHits(loadSrcTree());
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
