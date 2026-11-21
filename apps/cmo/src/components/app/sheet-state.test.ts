import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");

it("lets a post's state wrap in the open post, so its reason never pushes the sheet wider", () => {
  // `.state` stays on one line on cards; in the sheet it can carry a reason
  // ("Didn't go out. X paused our posting for a day. …").
  const rule =
    /\.post-foot \.state,\s*\.sheet-state \.state\s*\{([^}]*)\}/.exec(css)?.[1];
  expect(rule).toBeDefined();
  expect(rule).toMatch(/white-space:\s*normal/);
  expect(rule).toMatch(/min-width:\s*0/);
});
