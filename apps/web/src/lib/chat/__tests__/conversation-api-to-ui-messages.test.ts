import { describe, expect, it } from "vitest";

import { convertItemsToMessages } from "../conversation-api-to-ui-messages";

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

  it("keeps file-only API content as renderable parts after hydration", () => {
    const messages = convertItemsToMessages([
      {
        id: "u2",
        role: "user",
        createdAt: 1700000001,
        content: [
          {
            type: "file",
            url: "https://example.com/image.png",
            mediaType: "image/png",
            filename: "image.png",
          },
        ],
      },
    ]);

    expect((messages[0] as { content?: string } | undefined)?.content).toBe("");
    expect(messages[0]?.parts).toEqual([
      {
        type: "file",
        url: "https://example.com/image.png",
        mediaType: "image/png",
        filename: "image.png",
      },
    ]);
  });

  it("attaches thought timing metadata when the API item includes thoughtTiming", () => {
    const messages = convertItemsToMessages([
      {
        id: "a1",
        role: "assistant",
        createdAt: 1700000000,
        content: [{ type: "output_text", text: "Hi" }],
        thoughtTiming: {
          startedAtMs: 1000,
          endedAtMs: 5000,
        },
      },
    ]);
    expect(messages[0]?.metadata).toEqual({
      thoughtStartedAtMs: 1000,
      thoughtEndedAtMs: 5000,
    });
  });
});
