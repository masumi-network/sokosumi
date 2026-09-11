import { describe, expect, it } from "vitest";

import { markdownHighlighter } from "./markdown-highlighter";

describe("markdownHighlighter", () => {
  it("registers the chat language set and shell aliases", () => {
    expect(markdownHighlighter.listLanguages()).toEqual(
      expect.arrayContaining([
        "plaintext",
        "ts",
        "tsx",
        "js",
        "json",
        "shell",
        "python",
        "sql",
        "css",
        "html",
        "markdown",
      ]),
    );
    expect(markdownHighlighter.normalizeLanguage("bash")).toBe("shell");
    expect(markdownHighlighter.normalizeLanguage("typescript")).toBe("ts");
  });

  it("falls back unknown languages to escaped plaintext", () => {
    expect(markdownHighlighter.normalizeLanguage("ruby")).toBe("plaintext");

    const result = markdownHighlighter.highlight(
      '<img src=x onerror="alert(1)">',
      { lang: "ruby" },
    );

    expect(result.lang).toBe("plaintext");
    expect(result.html).toContain("&lt;img");
    expect(result.html).not.toMatch(/<img\b/i);
  });

  it("emits semantic token classes for TypeScript", () => {
    const result = markdownHighlighter.highlight("const value = 1;", {
      lang: "ts",
    });

    expect(result.html).toContain("th-keyword");
    expect(result.html).toContain("const");
  });

  it("does not throw on incomplete streamed code", () => {
    expect(() =>
      markdownHighlighter.highlight("def foo(\n", { lang: "python" }),
    ).not.toThrow();
    expect(() =>
      markdownHighlighter.highlight("```ts\nconst x =", { lang: "markdown" }),
    ).not.toThrow();
  });
});
