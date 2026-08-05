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

const FORBIDDEN = ["100svh-64px", "100svh-96px"] as const;

const EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

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

describe("no header-offset px shells", () => {
  it("bans 100svh-64px and 100svh-96px (use 4rem / 6rem to track Header h-16)", () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      // Self documents the banned substrings; skip.
      if (rel.endsWith("no-header-offset-px-shell.test.ts")) continue;

      const text = fs.readFileSync(file, "utf8");
      for (const needle of FORBIDDEN) {
        if (!text.includes(needle)) continue;
        hits.push(`${rel}: contains ${needle}`);
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
