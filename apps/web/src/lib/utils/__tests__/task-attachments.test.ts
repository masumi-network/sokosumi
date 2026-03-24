import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractTaskAttachmentUrls,
  formatTaskAttachmentMarkdown,
  removeTaskAttachmentLinks,
  sanitizeTaskAttachmentLabel,
  uploadTaskAttachment,
} from "@/lib/utils/task-attachments";

const uploadMyFileMock = vi.fn();

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    uploadMyFile: (...args: unknown[]) => uploadMyFileMock(...args),
  },
}));

describe("task-attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("uploads task attachments through the Core browser client", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });

    uploadMyFileMock.mockResolvedValue({
      data: {
        publicUrl: "https://blob.example/users/user_123/report.pdf",
      },
    });

    await expect(uploadTaskAttachment(file)).resolves.toBe(
      "https://blob.example/users/user_123/report.pdf",
    );
    expect(uploadMyFileMock).toHaveBeenCalledWith(file);
  });

  it("throws a generic error when the Core upload fails", async () => {
    const file = new File(["hello"], "report.pdf", {
      type: "application/pdf",
    });

    uploadMyFileMock.mockRejectedValue(new Error("Unauthorized"));

    await expect(uploadTaskAttachment(file)).rejects.toThrow(
      "Failed to upload file",
    );
  });
});
