import { describe, expect, it } from "vitest";

import { stripMarkdownToText } from "@/lib/utils/strip-markdown";

describe("stripMarkdownToText", () => {
  it("returns null for nullish input", () => {
    expect(stripMarkdownToText(null)).toBeNull();
    expect(stripMarkdownToText(undefined)).toBeNull();
  });

  it("strips links, images and inline formatting to plain text", () => {
    expect(
      stripMarkdownToText(
        "**Bold** [link](https://x.dev) ![alt](https://y.dev/i.png)",
      ),
    ).toBe("Bold link alt");
  });

  it("removes nested html tags without leaving a partial tag", () => {
    const result = stripMarkdownToText("<scr<script>ipt>alert(1)</script> hi");
    expect(result).not.toContain("<script");
    expect(result).not.toContain("<");
    expect(result).toContain("hi");
  });
});
