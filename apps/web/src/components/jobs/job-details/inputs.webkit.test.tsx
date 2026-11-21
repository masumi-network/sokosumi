import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import { NextIntlClientProvider } from "next-intl";
import { chromium } from "playwright";
import postcss from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import english from "../../../../messages/en.json";
import JobDetailsInputs from "./inputs";

const WIDTH = 160;
const TOKEN = "x".repeat(300);

async function pageStyles() {
  const source = path.resolve(import.meta.dirname, "../../../app/globals.css");
  return (
    await postcss([tailwindcss()]).process(await readFile(source, "utf8"), {
      from: source,
    })
  ).css;
}

/**
 * What this checks, in a real browser (happy-dom has no layout):
 * - an unbroken value (a long token in Markdown, compact JSON) stays inside
 *   a 160px column instead of growing past it;
 * - a sentence wraps between words: "Switzerland" stays on one line.
 */
it("keeps job input values inside a narrow column and wraps between words", async () => {
  const input = JSON.stringify({
    question: "Which agencies in Switzerland are the strongest prospects?",
    token: TOKEN,
    payload: { [TOKEN]: TOKEN },
  });
  const inputSchema = JSON.stringify({
    input_data: [
      { id: "question", type: "text", name: "Question", data: {} },
      { id: "token", type: "text", name: "Token", data: {} },
      { id: "payload", type: "number", name: "Payload", data: {} },
    ],
  });
  const markup = renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={english} timeZone="UTC">
      <main style={{ width: WIDTH }}>
        <JobDetailsInputs input={input} inputSchema={inputSchema} />
      </main>
    </NextIntlClientProvider>,
  );
  const css = await pageStyles();
  const browser = await chromium.launch({
    channel: existsSync(chromium.executablePath()) ? undefined : "chrome",
  });
  try {
    const page = await browser.newPage();
    await page.setContent(markup);
    await page.addStyleTag({ content: css });
    const layout = await page.evaluate(() => {
      const main = document.querySelector("main") as HTMLElement;
      const right = main.getBoundingClientRect().right;
      // Each input row is a label span, then the value box.
      const values = [
        ...main.querySelectorAll(".space-y-4 > div > span + div"),
      ];
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      let textNode: Node | null = walker.nextNode();
      while (textNode && !textNode.textContent?.includes("Switzerland")) {
        textNode = walker.nextNode();
      }
      let switzerlandLines = 0;
      if (textNode?.textContent) {
        const start = textNode.textContent.indexOf("Switzerland");
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, start + "Switzerland".length);
        switzerlandLines = new Set(
          [...range.getClientRects()].map((rect) => Math.round(rect.top)),
        ).size;
      }
      return {
        values: values.length,
        widestRight: Math.max(
          ...values.map((value) => value.getBoundingClientRect().right),
        ),
        widestScroll: Math.max(...values.map((value) => value.scrollWidth)),
        right,
        switzerlandLines,
      };
    });

    expect(layout.values).toBeGreaterThanOrEqual(3);
    expect(layout.widestRight).toBeLessThanOrEqual(layout.right + 1);
    expect(layout.widestScroll).toBeLessThanOrEqual(WIDTH + 1);
    expect(layout.switzerlandLines).toBe(1);
  } finally {
    await browser.close();
  }
}, 60_000);
