import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { cmoOverview } from "../../test-fixtures/cmo";
import { MonthCalendar } from "./month-calendar";

const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");

/** Every rule whose selector names `.name` as a whole class. */
function rulesNaming(name: string): string[] {
  const selectors = css.match(/[^{}]+(?=\{)/g) ?? [];
  const pattern = new RegExp(`\\.${name}(?![\\w-])`);
  return selectors
    .map((selector) => selector.trim())
    .filter((selector) => pattern.test(selector));
}

it("styles the chat card's month only through its own classes, so no other page's rule reaches it", () => {
  const strategy = cmoOverview().strategy;
  if (!strategy) throw new Error("fixture has a strategy");
  const html = renderToStaticMarkup(<MonthCalendar strategy={strategy} />);
  const classes = new Set(
    [...html.matchAll(/class="([^"]+)"/g)].flatMap((match) =>
      (match[1] ?? "").split(" "),
    ),
  );
  classes.delete("blank");
  expect([...classes].length).toBeGreaterThan(3);
  for (const name of classes) {
    // Only its own rules name its classes: the Calendar page's `.cal` and the
    // post preview's `.post` once restyled it into grey bars and big discs.
    const rules = rulesNaming(name);
    expect(rules.length, name).toBeGreaterThan(0);
    for (const rule of rules) {
      const named = rule.match(/\.[\w-]+/g) ?? [];
      expect(
        named.every(
          (cls) => /^\.(mini-cal|kind-)/.test(cls) || cls === ".blank",
        ),
        rule,
      ).toBe(true);
    }
  }
});
