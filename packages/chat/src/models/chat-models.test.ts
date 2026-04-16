import { describe, expect, it } from "vitest";

import { CHAT_MODELS, getModelIdentifier } from "./chat-models.js";

describe("chat models", () => {
  it("registers Claude Opus 4.7 with the OpenRouter slug", () => {
    const opusModel = CHAT_MODELS.find(
      (model) => model.id === "claude-opus-4-7",
    );

    expect(opusModel).toMatchObject({
      id: "claude-opus-4-7",
      name: "Claude Opus 4.7",
      openRouterId: "anthropic/claude-opus-4.7",
    });
  });

  it("maps the old Opus 4.6 model id to Opus 4.7", () => {
    expect(getModelIdentifier("claude-opus-4-6")).toBe(
      "anthropic/claude-opus-4.7",
    );
  });
});
