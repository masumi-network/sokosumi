// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WEB_GLOBALS = new URL(
  "../../../../apps/web/src/app/globals.css",
  import.meta.url,
);
const VIEW_TOKENS = new URL("./tokens.css", import.meta.url);

/** The custom properties declared directly in the first `selector {` block. */
function declarations(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) throw new Error(`No "${selector} {" block`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, "");
  return new Map(
    [...withoutComments.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
}

describe("fallback tokens", () => {
  const web = readFileSync(WEB_GLOBALS, "utf8");
  const views = readFileSync(VIEW_TOKENS, "utf8");

  for (const [theme, webSelector, viewSelector] of [
    ["light", ":root", ":root"],
    ["dark", ".dark", '[data-theme="dark"]'],
  ] as const) {
    it(`match Web's ${theme} values`, () => {
      const ours = declarations(views, viewSelector);
      const theirs = declarations(web, webSelector);

      expect(ours.size).toBeGreaterThan(0);
      for (const [name, value] of ours) {
        expect({ name, value }).toEqual({ name, value: theirs.get(name) });
      }
    });
  }

  it("declare the same names in both themes", () => {
    expect([...declarations(views, '[data-theme="dark"]').keys()]).toEqual([
      ...declarations(views, ":root").keys(),
    ]);
  });
});
