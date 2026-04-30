import { describe, expect, it } from "vitest";

import { CHAT_MODELS, getModelIdentifier } from "./chat-models.js";

describe("chat models", () => {
  it("registers upgraded OpenRouter model slugs", () => {
    expect(CHAT_MODELS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mimo-v2-5-pro",
          name: "MiMo V2.5 Pro",
          openRouterId: "xiaomi/mimo-v2.5-pro",
        }),
        expect.objectContaining({
          id: "kimi-k2-6",
          name: "Kimi K2.6",
          openRouterId: "moonshotai/kimi-k2.6",
        }),
        expect.objectContaining({
          id: "deepseek-v4-pro",
          name: "DeepSeek V4 Pro",
          openRouterId: "deepseek/deepseek-v4-pro",
        }),
        expect.objectContaining({
          id: "gpt-5-4",
          name: "GPT-5.4",
          openRouterId: "openai/gpt-5.4",
        }),
      ]),
    );
  });

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

  it("maps upgraded legacy model ids to current OpenRouter slugs", () => {
    expect(getModelIdentifier("kimi-k2-5")).toBe("moonshotai/kimi-k2.6");
    expect(getModelIdentifier("deepseek-v3-2")).toBe(
      "deepseek/deepseek-v4-pro",
    );
    expect(getModelIdentifier("gpt-5-2")).toBe("openai/gpt-5.4");
  });
});
