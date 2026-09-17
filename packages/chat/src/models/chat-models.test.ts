import { describe, expect, it } from "vitest";

import { CHAT_MODELS, getModelIdentifier } from "./chat-models.js";

describe("chat models", () => {
  it("registers current OpenRouter model slugs", () => {
    expect(CHAT_MODELS).toEqual([
      {
        id: "mimo-v2-5-pro",
        openRouterId: "xiaomi/mimo-v2.5-pro",
      },
      {
        id: "kimi-k2-6",
        openRouterId: "moonshotai/kimi-k2.6",
      },
      {
        id: "gemini-3-flash-preview",
        openRouterId: "google/gemini-3-flash-preview",
      },
      {
        id: "deepseek-v4-pro",
        openRouterId: "deepseek/deepseek-v4-pro",
      },
      {
        id: "claude-opus-4-7",
        openRouterId: "anthropic/claude-opus-4.7",
      },
      {
        id: "grok-4-1-fast",
        openRouterId: "x-ai/grok-4.1-fast",
      },
      {
        id: "gpt-5-4",
        openRouterId: "openai/gpt-5.4",
      },
    ]);
  });

  it("maps the old Opus 4.6 model id to Opus 4.7", () => {
    expect(getModelIdentifier("claude-opus-4-6")).toBe(
      "anthropic/claude-opus-4.7",
    );
  });

  it("maps upgraded legacy model ids to current OpenRouter slugs", () => {
    expect(getModelIdentifier("kimi-k2-5")).toBe("moonshotai/kimi-k2.6");
    expect(getModelIdentifier("deepseek-v3-2")).toBe(
      "deepseek/deepseek-v4-pro",
    );
    expect(getModelIdentifier("gpt-5-2")).toBe("openai/gpt-5.4");
  });
});
