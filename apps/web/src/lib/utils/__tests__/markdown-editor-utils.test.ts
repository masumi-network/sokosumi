import {
  formatHeading,
  formatInlineCodeSnippet,
  formatMarkdownLink,
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
});

describe("formatHeading", () => {
  it("uses a default heading when selection is empty", () => {
    expect(formatHeading("")).toBe("\n## Heading\n");
  });

  it("formats a markdown heading", () => {
    expect(formatHeading("Details")).toBe("\n## Details\n");
  });
});
