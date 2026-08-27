import { describe, expect, it } from "vitest";

import {
  deduplicateMessagesById,
  extractMessageContent,
  getMessageFileParts,
  hasMessageTextOrFileParts,
} from "./message-utils";

describe("extractMessageContent", () => {
  it("keeps only text parts, not reasoning", () => {
    const message = {
      id: "a1",
      role: "assistant" as const,
      parts: [
        { type: "reasoning" as const, text: "Processing..." },
        { type: "reasoning" as const, text: "Thinking..." },
        { type: "text" as const, text: "Hello world" },
      ],
    };
    expect(extractMessageContent(message)).toBe("Hello world");
  });

  it("returns empty when the assistant message has only reasoning parts", () => {
    const message = {
      id: "a2",
      role: "assistant" as const,
      parts: [{ type: "reasoning" as const, text: "Processing..." }],
    };
    expect(extractMessageContent(message)).toBe("");
  });

  it('does not surface text when part type is missing or not the string "text"', () => {
    expect(
      extractMessageContent({
        id: "a3",
        role: "assistant" as const,
        parts: [{ text: "leak" }],
      }),
    ).toBe("");

    expect(
      extractMessageContent({
        id: "a4",
        role: "assistant" as const,
        parts: [{ type: 1, text: "leak" }],
      } as unknown),
    ).toBe("");
  });

  it('whitelists only type "text" in content array object parts', () => {
    expect(
      extractMessageContent({
        id: "a5",
        role: "assistant" as const,
        content: [{ type: "reasoning" as const, text: "hidden" }],
      }),
    ).toBe("");

    expect(
      extractMessageContent({
        id: "a6",
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "visible" }],
      }),
    ).toBe("visible");
  });
});

describe("hasMessageTextOrFileParts", () => {
  it("returns false for synthetic empty text fallback parts", () => {
    expect(
      hasMessageTextOrFileParts({
        id: "u1",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "" }],
      }),
    ).toBe(false);
  });

  it("returns true for file-only user messages", () => {
    expect(
      hasMessageTextOrFileParts({
        id: "u2",
        role: "user" as const,
        parts: [
          {
            type: "file" as const,
            url: "https://example.com/brief.pdf",
            mediaType: "application/pdf",
            filename: "brief.pdf",
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("getMessageFileParts", () => {
  it("reads file parts from parts array", () => {
    expect(
      getMessageFileParts({
        id: "u3",
        role: "user" as const,
        parts: [
          {
            type: "file" as const,
            url: "https://example.com/a.png",
            mediaType: "image/png",
            filename: "a.png",
          },
        ],
      }),
    ).toEqual([
      {
        type: "file",
        url: "https://example.com/a.png",
        mediaType: "image/png",
        filename: "a.png",
      },
    ]);
  });
});

describe("deduplicateMessagesById", () => {
  it("keeps every message when ids are missing (no empty-key collapse)", () => {
    const messages: Array<{ id?: string; role: string }> = [
      { role: "user" },
      { role: "assistant" },
      { role: "user" },
    ];
    expect(deduplicateMessagesById(messages)).toEqual(messages);
  });

  it("keeps first only when duplicate non-empty ids", () => {
    const a = { id: "m1", text: "first" };
    const b = { id: "m1", text: "dup" };
    const c = { id: "m2", text: "other" };
    expect(deduplicateMessagesById([a, b, c])).toEqual([a, c]);
  });

  it("treats whitespace-only id as absent for deduplication", () => {
    const messages: Array<{ id?: string; role?: string }> = [
      { id: "   " },
      { id: "\t" },
      { role: "x" },
    ];
    expect(deduplicateMessagesById(messages)).toEqual(messages);
  });

  it("trims ids before comparing", () => {
    const a = { id: "  same  " };
    const b = { id: "same" };
    expect(deduplicateMessagesById([a, b])).toEqual([a]);
  });
});
