import { describe, expect, it } from "vitest";
import {
  descriptionIncludesTaskAttachmentLink,
  extractTaskAttachmentUrls,
  formatTaskAttachmentMarkdown,
  removeDesignMdAttachmentLinks,
  removeTaskAttachmentLinks,
  sanitizeTaskAttachmentLabel,
  seedTaskDescriptionWithDesignMd,
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

  it("detects attachment links with escaped markdown url characters", () => {
    const urlWithParen = "https://example.com/design).md";
    const markdown = [
      formatTaskAttachmentMarkdown("DESIGN.md", urlWithParen).trimEnd(),
      "",
      "Build landing page",
    ].join("\n");

    expect(
      descriptionIncludesTaskAttachmentLink(
        markdown,
        "DESIGN.md",
        urlWithParen,
      ),
    ).toBe(true);
    expect(
      descriptionIncludesTaskAttachmentLink(
        markdown,
        "DESIGN.md",
        "https://example.com/other.md",
      ),
    ).toBe(false);
    expect(markdown.includes(urlWithParen)).toBe(false);
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

  it("removes DESIGN.md links when the url contains escaped closing parens", () => {
    const urlWithParen = "https://blob.example/design).md";
    const markdown = [
      formatTaskAttachmentMarkdown("DESIGN.md", urlWithParen).trimEnd(),
      "",
      "Build landing page",
    ].join("\n");

    expect(removeDesignMdAttachmentLinks(markdown)).toBe("Build landing page");
  });

  it("seeds empty descriptions with DESIGN.md attachment links", () => {
    expect(
      seedTaskDescriptionWithDesignMd("", {
        label: "DESIGN.md",
        url: "https://blob.example/design.md",
      }),
    ).toBe("[DESIGN.md](https://blob.example/design.md)\n");
  });

  it("does not seed DESIGN.md over existing description text", () => {
    expect(
      seedTaskDescriptionWithDesignMd("Write docs", {
        label: "DESIGN.md",
        url: "https://blob.example/design.md",
      }),
    ).toBe("Write docs");
  });
});
