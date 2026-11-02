import { describe, expect, it } from "vitest";

import { extractMessageContent } from "./message-utils";

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
