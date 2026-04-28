import { describe, expect, it } from "vitest";

import {
  convertItemsToMessages,
  deduplicateMessagesById,
} from "../message-utils";

describe("convertItemsToMessages", () => {
  it("maps API content arrays with reasoning then assistant text", () => {
    const messages = convertItemsToMessages([
      {
        id: "a1",
        role: "assistant",
        createdAt: 1700000000,
        content: [
          { type: "reasoning", text: "Think" },
          { type: "output_text", text: "Hi" },
        ],
      },
    ]);
    expect(messages[0]?.parts).toEqual([
      { type: "reasoning", text: "Think" },
      { type: "text", text: "Hi" },
    ]);
  });

  it("maps provider-specific reasoning types to reasoning parts, not visible text", () => {
    const messages = convertItemsToMessages([
      {
        id: "a2",
        role: "assistant",
        createdAt: 1700000000,
        content: [
          { type: "redacted_reasoning", text: "[hidden]" },
          { type: "output_text", text: "Hi" },
        ],
      },
    ]);
    expect(messages[0]?.parts).toEqual([
      { type: "reasoning", text: "[hidden]" },
      { type: "text", text: "Hi" },
    ]);
  });

  it("maps file parts from API content arrays", () => {
    const messages = convertItemsToMessages([
      {
        id: "u1",
        role: "user",
        createdAt: 1700000001,
        content: [
          { type: "text", text: "See attached" },
          {
            type: "file",
            url: "https://example.com/blob.png",
            mediaType: "image/png",
            filename: "blob.png",
          },
        ],
      },
    ]);
    expect(messages[0]?.parts).toEqual([
      { type: "text", text: "See attached" },
      {
        type: "file",
        url: "https://example.com/blob.png",
        mediaType: "image/png",
        filename: "blob.png",
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
