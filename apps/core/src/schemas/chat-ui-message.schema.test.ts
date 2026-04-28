import { describe, expect, it } from "vitest";

import { chatUiFilePartSchema } from "./chat-ui-message.schema";

describe("chatUiFilePartSchema", () => {
  it("accepts https file URLs", () => {
    const parsed = chatUiFilePartSchema.parse({
      type: "file",
      url: "https://example.com/report.pdf",
      mediaType: "application/pdf",
      filename: "report.pdf",
    });

    expect(parsed.url).toBe("https://example.com/report.pdf");
  });

  it("rejects javascript URLs", () => {
    expect(() =>
      chatUiFilePartSchema.parse({
        type: "file",
        url: "javascript:alert(document.cookie)",
        mediaType: "text/html",
      }),
    ).toThrow();
  });

  it("rejects data URLs", () => {
    expect(() =>
      chatUiFilePartSchema.parse({
        type: "file",
        url: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
        mediaType: "text/html",
      }),
    ).toThrow();
  });

  it("rejects file URLs", () => {
    expect(() =>
      chatUiFilePartSchema.parse({
        type: "file",
        url: "file:///etc/passwd",
        mediaType: "text/plain",
      }),
    ).toThrow();
  });
});
