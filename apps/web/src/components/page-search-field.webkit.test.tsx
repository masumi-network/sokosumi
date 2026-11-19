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
import { PageSearchField } from "./page-search-field";

it("shows the shortcut according to the field's width, including beside a nonempty query", async () => {
  const source = path.resolve(import.meta.dirname, "../app/globals.css");
  const { css } = await postcss([tailwindcss()]).process(
    await readFile(source, "utf8"),
    { from: source },
  );
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
