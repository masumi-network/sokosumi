import { describe, expect, it } from "vitest";

import {
  lastTurnToResponsesInput,
  promptToResponsesInput,
} from "./to-responses-input.js";

describe("promptToResponsesInput", () => {
  it("maps system, user, and assistant to input_text messages", () => {
    const input = promptToResponsesInput([
      { role: "system", content: "You are helpful." },
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi!" }],
      },
    ]);
    expect(input).toEqual([
      {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: "You are helpful." }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "input_text", text: "Hi!" }],
      },
    ]);
  });

  it("skips empty user turns", () => {
    const input = promptToResponsesInput([
      {
        role: "user",
        content: [{ type: "text", text: "   " }],
      },
    ]);
    expect(input).toEqual([]);
  });
});

describe("lastTurnToResponsesInput", () => {
  it("keeps only the last user message when preceded by assistant", () => {
    const input = lastTurnToResponsesInput([
      {
        role: "user",
        content: [{ type: "text", text: "First" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Reply" }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Second" }],
      },
    ]);
    expect(input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Second" }],
      },
    ]);
  });

  it("includes trailing system when it is the last user/system message", () => {
    const input = lastTurnToResponsesInput([
      {
        role: "user",
        content: [{ type: "text", text: "Hi" }],
      },
      {
        role: "system",
        content: "Override",
      },
    ]);
    expect(input.some((m) => m.role === "system")).toBe(true);
  });
});
