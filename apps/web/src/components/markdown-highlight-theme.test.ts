import { describe, expect, it } from "vitest";

import { markdownHighlightThemeCss } from "@/components/markdown-highlight-theme";

describe("markdownHighlightThemeCss", () => {
  it("uses shipped GitHub light and dark token colors", () => {
    expect(markdownHighlightThemeCss).toContain("pre.th-code {");
    expect(markdownHighlightThemeCss).toContain(".dark pre.th-code");
    expect(markdownHighlightThemeCss).toContain("--th-keyword: #cf222e");
    expect(markdownHighlightThemeCss).toContain("--th-keyword: #ff7b72");
    expect(markdownHighlightThemeCss).toContain("--th-background: transparent");
    expect(markdownHighlightThemeCss).not.toContain("var(--primary-iris)");
    expect(markdownHighlightThemeCss).not.toContain("var(--primary)");
  });
});
