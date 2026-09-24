import { describe, expect, it } from "vitest";
import { isBlockMarkdownElement } from "@/lib/utils/markdown-editor-utils";

describe("isBlockMarkdownElement", () => {
  it("treats line-break containers and lists as blocks", () => {
    expect(isBlockMarkdownElement("div", "line\n")).toBe(true);
    expect(isBlockMarkdownElement("p", "line\n")).toBe(true);
    expect(isBlockMarkdownElement("blockquote", "quote\n")).toBe(true);
    expect(isBlockMarkdownElement("h2", "## heading\n")).toBe(true);
    expect(isBlockMarkdownElement("ul", "- item\n")).toBe(true);
    expect(isBlockMarkdownElement("pre", "```\ncode\n```\n")).toBe(true);
  });

  it("treats fenced code as a block but not inline code", () => {
    expect(isBlockMarkdownElement("code", "```\ncode\n```\n")).toBe(true);
    expect(isBlockMarkdownElement("code", "`inline`")).toBe(false);
  });

  it("does not treat br or inline tags as blocks", () => {
    expect(isBlockMarkdownElement("br", "\n")).toBe(false);
    expect(isBlockMarkdownElement("strong", "**bold**")).toBe(false);
    expect(isBlockMarkdownElement("a", "[label](https://example.com)")).toBe(
      false,
    );
  });
});
