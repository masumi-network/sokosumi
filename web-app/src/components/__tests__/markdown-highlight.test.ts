import { applyMarkdownHighlighting } from "@/components/markdown-highlight";

describe("applyMarkdownHighlighting", () => {
  it("should return original markdown when no term is provided", () => {
    const markdown = "This is some **bold** text.";
    const result = applyMarkdownHighlighting(markdown, {});
    expect(result).toBe(markdown);
  });

  it("should return original markdown when term is empty", () => {
    const markdown = "This is some **bold** text.";
    const result = applyMarkdownHighlighting(markdown, { term: "" });
    expect(result).toBe(markdown);
  });

  it("should highlight text matches", () => {
    const markdown = "This is some bold text.";
    const result = applyMarkdownHighlighting(markdown, { term: "bold" });
    expect(result).toContain("mark");
    expect(result).toContain("bold");
  });

  it("should be case insensitive", () => {
    const markdown = "This is some BOLD text.";
    const result = applyMarkdownHighlighting(markdown, { term: "bold" });
    expect(result).toContain("mark");
    expect(result).toContain("BOLD");
  });

  it("should handle special regex characters safely", () => {
    const markdown = "Testing $100 and (parentheses).";
    const result = applyMarkdownHighlighting(markdown, { term: "$100" });
    expect(result).toContain("$100");
  });

  it("should limit query length", () => {
    const markdown = "This is test content.";
    const longTerm = "a".repeat(300);
    const result = applyMarkdownHighlighting(markdown, { term: longTerm });
    expect(result).toBe(markdown);
  });

  it("should handle empty markdown", () => {
    const result = applyMarkdownHighlighting("", { term: "test" });
    expect(result).toBe("");
  });

  it("should handle no matches", () => {
    const markdown = "This content has no matching terms.";
    const result = applyMarkdownHighlighting(markdown, { term: "xyz" });
    expect(result).toBe(markdown);
  });

  it("should handle code blocks", () => {
    const markdown = "```\nconst test = 'value';\n```";
    const result = applyMarkdownHighlighting(markdown, { term: "test" });
    expect(result).not.toBe(markdown);
  });
});
