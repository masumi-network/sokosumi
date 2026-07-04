import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import {
  isCoworkerChatConflictError,
  parseChatApiErrorBody,
  removeTrailingUserUiMessage,
} from "@/app/chat-ui/utils/chat-api-error";

describe("chat-api-error", () => {
  it("parses Core chat error JSON from AI SDK transport errors", () => {
    const error = new Error(
      JSON.stringify({
        error: "Conflict",
        message:
          "A coworker response is already in progress for this conversation.",
      }),
    );

    expect(parseChatApiErrorBody(error)).toEqual({
      error: "Conflict",
      message:
        "A coworker response is already in progress for this conversation.",
    });
    expect(isCoworkerChatConflictError(error)).toBe(true);
  });

  it("returns false for non-conflict chat errors", () => {
    const error = new Error(
      JSON.stringify({
        error: "Internal Server Error",
        message: "Unexpected failure",
      }),
    );

    expect(isCoworkerChatConflictError(error)).toBe(false);
  });

  it("removes only a trailing user message", () => {
    const messages = [
      { id: "u-1", role: "user", parts: [{ type: "text", text: "Hi" }] },
      {
        id: "a-1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello" }],
      },
      { id: "u-2", role: "user", parts: [{ type: "text", text: "Again" }] },
    ] satisfies UIMessage[];

    expect(removeTrailingUserUiMessage(messages)).toEqual(messages.slice(0, 2));
    expect(
      removeTrailingUserUiMessage([
        {
          id: "a-1",
          role: "assistant",
          parts: [{ type: "text", text: "Hello" }],
        },
      ] satisfies UIMessage[]),
    ).toHaveLength(1);
  });
});
