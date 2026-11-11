/**
 * The composer loads Markdown through `innerHTML`, and a real HTML parser
 * drops U+0000 from text where happy-dom keeps it. A link destination kept as
 * text must come back exactly, NUL included, and must not turn into a link on
 * the next load. Run with `pnpm --filter web test:webkit` (Chromium installed).
 */
import { type Browser, chromium, type Page } from "playwright";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startChatRowFixtureServer } from "@/app/chat/components/__tests__/chat-row-fixture-server";

const MODULE = "/src/lib/utils/composer-markdown-dom.ts";

let server: ViteDevServer;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  server = await startChatRowFixtureServer({
    pageModule: MODULE,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8" /></head><body></body></html>`,
    cacheDir: ".vite-composer-markdown",
  });
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture port");
  browser = await chromium.launch({ chromiumSandbox: true });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.addScriptTag({
    type: "module",
    content: `window.composer = await import(${JSON.stringify(MODULE)});`,
  });
  await page.waitForFunction(() => "composer" in window);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

/** Loads `source` into a composer-like element, saves, then loads that again. */
function roundTrip(source: string) {
  return page.evaluate((source) => {
    const { markdownToHtml, htmlToMarkdown } = (
      window as unknown as {
        composer: typeof import("./composer-markdown-dom");
      }
    ).composer;
    const resolve = (key: string) =>
      key === "agent-1"
        ? { displayName: "Company Researcher", isKnown: true }
        : { displayName: key, isKnown: false };
    const load = (markdown: string) => {
      const root = document.createElement("div");
      root.innerHTML = markdownToHtml(markdown, resolve);
      return root;
    };
    const first = load(source);
    const saved: string = htmlToMarkdown(first).trim();
    const hrefs = (root: HTMLElement) =>
      [...root.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    return {
      saved,
      hrefs: hrefs(first),
      reopenedHrefs: hrefs(load(saved)),
      reopenedSaved: htmlToMarkdown(load(saved)).trim(),
    };
  }, source);
}

describe("Chromium composer Markdown", () => {
  it.each([
    ["NUL", "[go](/contacts\u0000x)"],
    ["NUL first", "[go](/\u0000/evil.test/x)"],
    ["SOH", "[go](/a\u0001b)"],
    ["DEL", "[go](/contacts?contact=c-1\u007f)"],
    ["protocol-relative", "[go](//evil.test/x)"],
    ["backslash", "[go](/\\evil.test/x)"],
  ])(
    "keeps a rejected destination (%s) as its exact text",
    async (_name, source) => {
      const result = await roundTrip(source);
      expect(result.hrefs).toEqual([]);
      expect(result.saved).toBe(source);
      expect(result.reopenedHrefs).toEqual([]);
      expect(result.reopenedSaved).toBe(source);
    },
  );

  it("keeps NUL in plain text too", async () => {
    const source = "a\u0000b";
    expect((await roundTrip(source)).saved).toBe(source);
  });

  it("links a saved contact, and keeps agent and email intact", async () => {
    const source =
      "Call [Maya Stone](/contacts?contact=c-1), ask @agent-1:company-researcher, write maya@stone.example or [mail](mailto:maya@stone.example)";
    const result = await roundTrip(source);
    expect(result.hrefs).toEqual([
      "/contacts?contact=c-1",
      "mailto:maya@stone.example",
    ]);
    expect(result.saved).toBe(source);
    expect(result.reopenedSaved).toBe(source);
  });
});
