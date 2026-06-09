import { describe, expect, it } from "vitest";
import {
  extractTaskAttachmentUrls,
  formatTaskAttachmentMarkdown,
  removeDesignMdAttachmentLinks,
  removeTaskAttachmentLinks,
  sanitizeTaskAttachmentLabel,
} from "@/lib/utils/task-attachments";

describe("task-attachments", () => {
  it("extracts file-like markdown links", () => {
    const markdown = [
      "Some text",
      "[doc](https://example.com/file.pdf)",
      "[site](https://example.com)",
      "[image](https://example.com/image.png)",
      "[image with escaped paren](https://example.com/image\\).png)",
    ].join("\n");

    expect(extractTaskAttachmentUrls(markdown)).toEqual([
      "https://example.com/file.pdf",
      "https://example.com/image.png",
      "https://example.com/image).png",
    ]);
  });

  it("removes markdown links for specific urls", () => {
    const markdown = [
      "Task details",
      "",
      "[file-one](https://example.com/one.pdf)",
      "[file-two](https://example.com/two.pdf)",
      "",
      "More text",
    ].join("\n");

    expect(
      removeTaskAttachmentLinks(markdown, ["https://example.com/one.pdf"]),
    ).toBe(
      [
        "Task details",
        "",
        "[file-two](https://example.com/two.pdf)",
        "",
        "More text",
      ].join("\n"),
    );
  });

  it("formats attachment links in canonical markdown style", () => {
    expect(
      formatTaskAttachmentMarkdown(
        "invoice.pdf",
        "https://example.com/invoice.pdf",
      ),
    ).toBe("[invoice.pdf](https://example.com/invoice.pdf)\n");
  });

  it("formats and removes links when url contains closing parenthesis", () => {
    const urlWithParen = "https://example.com/image).png";
    const markdown = [
      "Task details",
      "",
      formatTaskAttachmentMarkdown("image).png", urlWithParen).trimEnd(),
      "",
      "More text",
    ].join("\n");

    expect(extractTaskAttachmentUrls(markdown)).toEqual([urlWithParen]);
    expect(removeTaskAttachmentLinks(markdown, [urlWithParen])).toBe(
      ["Task details", "", "More text"].join("\n"),
    );
  });

  it("sanitizes attachment labels that contain markdown brackets", () => {
    expect(sanitizeTaskAttachmentLabel("report[v2].pdf")).toBe("reportv2.pdf");
    expect(sanitizeTaskAttachmentLabel("[]", "fallback-file")).toBe(
      "fallback-file",
    );
  });

  it("removes DESIGN.md attachment links from task descriptions", () => {
    const markdown = [
      "[DESIGN.md](https://blob.example/design.md)",
      "",
      "Build landing page",
    ].join("\n");

    expect(removeDesignMdAttachmentLinks(markdown)).toBe("Build landing page");
  });
});
