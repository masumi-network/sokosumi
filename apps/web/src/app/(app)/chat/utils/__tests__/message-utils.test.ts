import { describe, expect, it } from "vitest";

import {
  deduplicateMessagesById,
  extractMessageContent,
  extractReasoningStepMessages,
} from "../message-utils";

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

describe("extractReasoningStepMessages", () => {
  it("lists reasoning parts in order with stable ids", () => {
    const message = {
      id: "mid",
      role: "assistant" as const,
      parts: [
        { type: "reasoning" as const, text: "Processing..." },
        { type: "text" as const, text: "Hi" },
        { type: "reasoning" as const, text: "More thought" },
      ],
    };
    expect(extractReasoningStepMessages(message)).toEqual([
      { id: "mid-reasoning-0", message: "More thought" },
    ]);
  });

  it("strips Thinking... prefix concatenated with real summary", () => {
    const message = {
      id: "m2",
      role: "assistant" as const,
      parts: [
        {
          type: "reasoning" as const,
          text: "Thinking...I will check the facts first.",
        },
      ],
    };
    expect(extractReasoningStepMessages(message)).toEqual([
      { id: "m2-reasoning-0", message: "I will check the facts first." },
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
