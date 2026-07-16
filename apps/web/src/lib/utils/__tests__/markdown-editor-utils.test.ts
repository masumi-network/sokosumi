import { describe, expect, it } from "vitest";
import {
  formatHeading,
  formatInlineCodeSnippet,
  formatMarkdownLink,
  isBlockMarkdownElement,
} from "@/lib/utils/markdown-editor-utils";

describe("formatInlineCodeSnippet", () => {
  it("wraps inline code without introducing HTML", () => {
    expect(formatInlineCodeSnippet("<script>alert('xss')</script>")).toBe(
      "`<script>alert('xss')</script>`",
    );
  });

  it("uses fenced blocks for multiline selections", () => {
    expect(formatInlineCodeSnippet("line1\nline2")).toBe(
      "```\nline1\nline2\n```",
    );
  });

  it("expands the fence when selection includes backticks", () => {
    expect(formatInlineCodeSnippet("```")).toBe("````\n```\n````");
  });
});

describe("formatMarkdownLink", () => {
  it("returns null for unsafe urls", () => {
    expect(formatMarkdownLink("label", "javascript:alert(1)")).toBeNull();
  });

  it("escapes label brackets and url parens", () => {
    const result = formatMarkdownLink(
      "link ]text",
      "https://example.com/path)",
    );
    expect(result).toContain("link \\]text");
    expect(result).toContain("path\\)");
  });

  it("escapes a trailing backslash in the label before the bracket escape", () => {
    // Backslash escaped first so it cannot merge with the `]` escape and
    // break out of the link text.
    const result = formatMarkdownLink("trail\\]", "https://example.com/p)q");
    expect(result).toBe("[trail\\\\\\]](https://example.com/p\\)q)");
  });
});

describe("formatHeading", () => {
  it("uses a default heading when selection is empty", () => {
    expect(formatHeading("")).toBe("\n## Heading\n");
  });

  it("formats a markdown heading", () => {
    expect(formatHeading("Details")).toBe("\n## Details\n");
  });
});

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
