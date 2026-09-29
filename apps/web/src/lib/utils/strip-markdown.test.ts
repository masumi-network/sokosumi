import { describe, expect, it } from "vitest";

import {
  stripInlineMarkdown,
  stripMarkdownToText,
} from "@/lib/utils/strip-markdown";

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

describe("stripInlineMarkdown", () => {
  it("removes paired emphasis, code and links", () => {
    expect(
      stripInlineMarkdown(
        "**Task Name:** _Weekly_ *brief* ~~old~~ `code` [doc](https://x.dev)",
      ),
    ).toBe("Task Name: Weekly brief old code doc");
  });

  it("drops a leading heading marker", () => {
    expect(stripInlineMarkdown("## Weekly brief")).toBe("Weekly brief");
  });

  it("keeps lone markers that are part of the name", () => {
    expect(stripInlineMarkdown("fix_login_flow")).toBe("fix_login_flow");
    expect(stripInlineMarkdown("Issue #42: A > B, 2 * 3")).toBe(
      "Issue #42: A > B, 2 * 3",
    );
  });

  it("keeps a name that is only markers", () => {
    expect(stripInlineMarkdown("**")).toBe("**");
  });
});
