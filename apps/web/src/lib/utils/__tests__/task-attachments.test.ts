import { describe, expect, it } from "vitest";
import {
  createDesignMdDismissedState,
  descriptionIncludesTaskAttachmentLink,
  ensureDesignMdInDescription,
  extractTaskAttachmentUrls,
  formatTaskAttachmentMarkdown,
  isDesignMdAttachmentSkipped,
  markDesignMdDismissed,
  removeTaskAttachmentLinks,
  sanitizeTaskAttachmentLabel,
  seedTaskDescriptionWithDesignMd,
  syncDesignMdDismissedState,
} from "@/lib/utils/task-attachments";

const designMdAttachment = {
  label: "DESIGN.md",
  url: "https://blob.example/design.md",
};

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

  it("prepends DESIGN.md to non-empty descriptions when ensuring attachment", () => {
    expect(
      ensureDesignMdInDescription("Write docs", {
        label: "DESIGN.md",
        url: "https://blob.example/design.md",
      }),
    ).toBe("[DESIGN.md](https://blob.example/design.md)\n\nWrite docs");
  });

  it("marks design.md as dismissed after the prefilled link disappears", () => {
    const state = createDesignMdDismissedState();
    const seededDescription = seedTaskDescriptionWithDesignMd(
      "",
      designMdAttachment,
    );

    syncDesignMdDismissedState(seededDescription, designMdAttachment, state);
    expect(isDesignMdAttachmentSkipped(state)).toBe(false);

    syncDesignMdDismissedState("Build landing page", designMdAttachment, state);
    expect(isDesignMdAttachmentSkipped(state)).toBe(true);
  });

  it("does not skip design.md when the link was never prefilled", () => {
    const state = createDesignMdDismissedState();

    syncDesignMdDismissedState("Write docs", designMdAttachment, state);
    expect(isDesignMdAttachmentSkipped(state)).toBe(false);
  });

  it("marks design.md dismissed immediately when removed via attachment control", () => {
    const state = createDesignMdDismissedState();
    const seededDescription = seedTaskDescriptionWithDesignMd(
      "",
      designMdAttachment,
    );

    syncDesignMdDismissedState(seededDescription, designMdAttachment, state);
    markDesignMdDismissed(state);

    expect(isDesignMdAttachmentSkipped(state)).toBe(true);
  });
});
