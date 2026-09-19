import { describe, expect, it } from "vitest";

import { getModelIdentifier } from "./chat-models.js";

describe("getModelIdentifier", () => {
  it("returns the default OpenRouter slug when no model is selected", () => {
    expect(getModelIdentifier(null)).toBe("openai/gpt-5.4");
    expect(getModelIdentifier("")).toBe("openai/gpt-5.4");
  });

  it("returns a provided OpenRouter slug as-is", () => {
    expect(getModelIdentifier("openai/gpt-5.4")).toBe("openai/gpt-5.4");
    expect(getModelIdentifier("anthropic/claude-opus-4.7")).toBe(
      "anthropic/claude-opus-4.7",
    );
  });
});
