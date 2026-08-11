import { describe, expect, it } from "vitest";

import { chatRequestMessagePartSchema } from "@/schemas/chat-request.schema";

import {
  chatUiFilePartSchema,
  chatUiReasoningPartSchema,
} from "./chat-ui-message.schema";

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

describe("chatUiReasoningPartSchema", () => {
  it("rejects parts with only text (missing type)", () => {
    expect(() => chatUiReasoningPartSchema.parse({ text: "hello" })).toThrow();
  });

  it("rejects blank or whitespace-only type", () => {
    expect(() =>
      chatUiReasoningPartSchema.parse({ type: "", text: "x" }),
    ).toThrow();
    expect(() =>
      chatUiReasoningPartSchema.parse({ type: "   ", text: "x" }),
    ).toThrow();
  });

  it("accepts type reasoning", () => {
    expect(
      chatUiReasoningPartSchema.parse({
        type: "reasoning",
        text: "thinking",
      }),
    ).toEqual({ type: "reasoning", text: "thinking" });
  });

  it("rejects reserved body part types", () => {
    expect(() =>
      chatUiReasoningPartSchema.parse({ type: "text", text: "x" }),
    ).toThrow();
  });

  it("rejects tool/step, legacy, and other non-allowlisted types", () => {
    expect(() =>
      chatUiReasoningPartSchema.parse({ type: "tool-call", text: "x" }),
    ).toThrow();
    expect(() =>
      chatUiReasoningPartSchema.parse({ type: "step-start", text: "x" }),
    ).toThrow();
    expect(() =>
      chatUiReasoningPartSchema.parse({
        type: "redacted_reasoning",
        text: "x",
      }),
    ).toThrow();
    expect(() =>
      chatUiReasoningPartSchema.parse({
        type: "unknown_provider_part",
        text: "x",
      }),
    ).toThrow();
  });
});

describe("chatRequestMessagePartSchema (union)", () => {
  it("rejects ambiguous { text } objects so they are not classified as reasoning", () => {
    expect(() =>
      chatRequestMessagePartSchema.parse({ text: "hello" }),
    ).toThrow();
  });
});
