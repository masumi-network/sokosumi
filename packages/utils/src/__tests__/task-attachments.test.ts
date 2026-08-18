import { describe, expect, it } from "vitest";

import {
  descriptionIncludesTaskAttachmentLink,
  formatTaskAttachmentMarkdown,
} from "../task-attachments.js";

describe("task attachment markdown", () => {
  it("formats labels and escapes closing parentheses in URLs", () => {
    expect(
      formatTaskAttachmentMarkdown(
        "DESIGN.md",
        "https://example.com/file(test).md",
      ),
    ).toBe("[DESIGN.md](https://example.com/file(test\\).md)\n");
  });

  it("detects an exact formatted attachment link", () => {
    const url = "https://example.com/context.md";
    const markdown = `${formatTaskAttachmentMarkdown("CONTEXT.md", url)}\nTask`;

    expect(
      descriptionIncludesTaskAttachmentLink(markdown, "CONTEXT.md", url),
    ).toBe(true);
    expect(
      descriptionIncludesTaskAttachmentLink(markdown, "BRIEFING.md", url),
    ).toBe(false);
  });
});
