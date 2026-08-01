import { describe, expect, it } from "vitest";

import {
  htmlToMarkdown,
  markdownToHtml,
} from "@/lib/utils/composer-markdown-dom";

describe("markdownToHtml", () => {
  it("renders italic/bold/strike/code with markers removed from HTML", () => {
    const html = markdownToHtml("hello _world_ and **bold** ~~x~~ `c`");
    expect(html).toContain("<em>world</em>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<s>x</s>");
    expect(html).toContain("<code>c</code>");
    expect(html).not.toContain("_world_");
    expect(html).not.toContain("**bold**");
  });

  it("renders underline stored as <u> tags", () => {
    expect(markdownToHtml("say <u>hi</u>")).toContain("<u>hi</u>");
  });

  it("renders blockquotes from > lines", () => {
    expect(markdownToHtml("> quoted")).toContain(
      "<blockquote>quoted</blockquote>",
    );
  });
});

describe("htmlToMarkdown", () => {
  function fromHtml(html: string): string {
    const root = document.createElement("div");
    root.innerHTML = html;
    return htmlToMarkdown(root);
  }

  it("round-trips inline formats to markdown markers", () => {
    expect(fromHtml("hello <em>world</em>")).toBe("hello _world_");
    expect(fromHtml("<strong>bold</strong>")).toBe("**bold**");
    expect(fromHtml("<s>gone</s>")).toBe("~~gone~~");
    expect(fromHtml("<code>c</code>")).toBe("`c`");
    expect(fromHtml("<u>hi</u>")).toBe("<u>hi</u>");
  });

  it("serializes blockquote with > prefix", () => {
    expect(fromHtml("<blockquote>quoted</blockquote>").trim()).toBe("> quoted");
  });

  it("round-trips markdown → html → markdown for common wraps", () => {
    const source = "a _b_ **c** ~~d~~ `e` <u>f</u>";
    const html = markdownToHtml(source);
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(htmlToMarkdown(root).trim()).toBe(source);
  });
});
