import { describe, expect, it, vi } from "vitest";

import {
  markdownHighlighter,
  rehypeMarkdownCodeHighlight,
} from "./markdown-highlighter";

vi.mock("@tanstack/highlight/rehype", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/highlight/rehype")>();
  let preCodeCalls = 0;
  return {
    ...actual,
    rehypePreCodeToHast: (
      node: Parameters<typeof actual.rehypePreCodeToHast>[0],
      options: Parameters<typeof actual.rehypePreCodeToHast>[1],
    ) => {
      preCodeCalls += 1;
      if (preCodeCalls === 1) {
        throw new Error("unexpected tokenizer throw");
      }
      return actual.rehypePreCodeToHast(node, options);
    },
  };
});

describe("markdownHighlighter", () => {
  it("registers the chat language set and shell aliases", () => {
    expect(markdownHighlighter.listLanguages()).toEqual(
      expect.arrayContaining([
        "plaintext",
        "ts",
        "tsx",
        "jsx",
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
    expect(markdownHighlighter.normalizeLanguage("jsx")).toBe("jsx");
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

  it("keeps highlighting later fences when one pre throws", () => {
    const tree = {
      type: "root",
      children: [
        fencedTsPre("const first = 1;"),
        fencedTsPre("const second = 2;"),
      ],
    };

    rehypeMarkdownCodeHighlight()(tree);

    const [first, second] = tree.children;
    expect(JSON.stringify(first)).toContain("const first = 1;");
    expect(JSON.stringify(first)).not.toContain("th-code");
    expect(JSON.stringify(second)).toContain("th-code");
    expect(JSON.stringify(second)).toContain("th-keyword");
    expect(JSON.stringify(second)).toContain("second");
  });
});

function fencedTsPre(code: string) {
  return {
    type: "element" as const,
    tagName: "pre",
    children: [
      {
        type: "element" as const,
        tagName: "code",
        properties: { className: ["language-ts"] },
        children: [{ type: "text" as const, value: code }],
      },
    ],
  };
}
