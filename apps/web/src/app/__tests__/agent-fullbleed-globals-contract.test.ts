import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const GLOBALS_CSS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../globals.css",
);

/** Drop block + line comments so explanatory prose cannot false-fail. */
function cssWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("agent fullbleed globals.css contract", () => {
  it("keys shell padding/overflow off body attr, not :has", () => {
    const css = readFileSync(GLOBALS_CSS, "utf8");
    const rules = cssWithoutComments(css);

    expect(rules).toContain('body[data-agent-fullbleed="true"]');
    expect(rules).not.toMatch(/:has\(\[data-agent-fullbleed\]\)/);
  });
});
