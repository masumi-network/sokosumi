import { describe, expect, it } from "vitest";

import { promptToResponsesInput } from "./to-responses-input.js";

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
