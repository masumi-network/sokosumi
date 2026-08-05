import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Paths relative to apps/web/src that may keep px font sizes (non-product UI). */
const ALLOWLIST = new Set(["app/api/export/pdf/route.ts"]);

// Decimal px allowed in the pattern (e.g. text-[10.5px]). Intentional limits:
// does not scan template assignments like root.style.fontSize = `${n}px`.
const TEXT_PX_CLASS = /text-\[\d+(?:\.\d+)?px\]/;
const FONT_SIZE_PX = /font-size:\s*\d+(?:\.\d+)?px/i;
const FONT_SIZE_STYLE_NUM = /fontSize:\s*\d+(?:\.\d+)?\b/;
const FONT_SIZE_STYLE_PX = /fontSize:\s*["']\d+(?:\.\d+)?px["']/;

const EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (EXTENSIONS.has(path.extname(name))) {
      out.push(full);
    }
  }
  return out;
}

describe("no fixed px font sizes in product UI", () => {
  it("has no text-[Npx], font-size: Npx, or fontSize: N outside allowlist", () => {
    const violations: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      if (ALLOWLIST.has(rel)) continue;
      // Self + apply unit tests mock { fontSize: "28px" } style objects.
      if (rel.endsWith("no-fixed-font-size.test.ts")) continue;
      if (rel.endsWith("dynamic-type.test.ts")) continue;

      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      lines.forEach((line, i) => {
        if (
          TEXT_PX_CLASS.test(line) ||
          FONT_SIZE_PX.test(line) ||
          FONT_SIZE_STYLE_NUM.test(line) ||
          FONT_SIZE_STYLE_PX.test(line)
        ) {
          violations.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});
