import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import { NextIntlClientProvider } from "next-intl";
import { chromium } from "playwright";
import postcss from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import english from "../../messages/en.json";
import { PageSearchActions } from "./page-search-actions";
import { PageSearchField } from "./page-search-field";

async function pageStyles() {
  const source = path.resolve(import.meta.dirname, "../app/globals.css");
  return (
    await postcss([tailwindcss()]).process(await readFile(source, "utf8"), {
      from: source,
    })
  ).css;
}

it("shows the shortcut according to the field's width, including beside a nonempty query", async () => {
  const css = await pageStyles();
  const markup = renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={english} timeZone="UTC">
      <main>
        <div style={{ width: 160 }}>
          <PageSearchField
            placeholder="Projects"
            value=""
            onValueChange={() => {}}
          />
        </div>
        <div style={{ width: 320 }}>
          <PageSearchField
            placeholder="Tasks"
            value="Launch"
            onValueChange={() => {}}
          />
        </div>
      </main>
    </NextIntlClientProvider>,
  );
  const browser = await chromium.launch({
    channel: existsSync(chromium.executablePath()) ? undefined : "chrome",
  });
  try {
    const page = await browser.newPage();
    await page.setContent(markup);
    await page.addStyleTag({ content: css });
    const hints = page.locator("kbd");
    expect(await hints.first().isVisible()).toBe(false);
    expect(await hints.last().isVisible()).toBe(true);
    const hint = await hints.last().boundingBox();
    const clear = await page
      .getByRole("button", { name: "Clear search" })
      .boundingBox();
    expect(hint && clear && hint.x + hint.width <= clear.x).toBe(true);
  } finally {
    await browser.close();
  }
}, 60_000);

it("keeps search before its local action and wraps the group at the available page width", async () => {
  const css = await pageStyles();
  const markup = renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={english} timeZone="UTC">
      <main>
        <div className="@container/page-toolbar flex flex-wrap items-center gap-3">
          <h1>Saved audits</h1>
          <PageSearchActions>
            <PageSearchField
              inHeader
              placeholder="Search reports"
              value=""
              onValueChange={() => {}}
            />
            <button type="button">Create audit</button>
          </PageSearchActions>
        </div>
      </main>
    </NextIntlClientProvider>,
  );
  const browser = await chromium.launch({
    channel: existsSync(chromium.executablePath()) ? undefined : "chrome",
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 300 },
    });
    await page.setContent(markup);
    await page.addStyleTag({ content: css });
    for (const width of [1000, 636, 342]) {
      await page.locator("main").evaluate((element, value) => {
        element.style.width = value + "px";
      }, width);
      const title = await page.getByRole("heading").boundingBox();
      const field = await page.getByRole("searchbox").boundingBox();
      const action = await page.getByRole("button").boundingBox();
      if (!title || !field || !action)
        throw new Error("Missing toolbar geometry");
      expect(action.x).toBeGreaterThanOrEqual(field.x + field.width);
      expect(action.x + action.width).toBeCloseTo(width, 0);
      expect(action.y + action.height / 2).toBeCloseTo(
        field.y + field.height / 2,
        0,
      );
      if (width === 1000) {
        expect(field.width).toBe(256);
        expect(field.height).toBe(32);
        expect(title.y + title.height / 2).toBeCloseTo(
          field.y + field.height / 2,
          0,
        );
      } else {
        expect(field.y).toBeGreaterThanOrEqual(title.y + title.height);
        expect(field.height).toBe(40);
      }
    }
  } finally {
    await browser.close();
  }
}, 60_000);
