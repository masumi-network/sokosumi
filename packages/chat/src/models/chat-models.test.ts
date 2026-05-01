import { describe, expect, it } from "vitest";

import {
  CHAT_MODELS,
  chatModelSupportsImageGeneration,
  chatModelSupportsImageInput,
  chatModelSupportsWebSearch,
  getChatModelImageGenerationOpenRouterId,
  getModelIdentifier,
} from "./chat-models.js";

describe("chat models", () => {
  it("registers upgraded OpenRouter model slugs", () => {
    expect(CHAT_MODELS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mimo-v2-5-pro",
          name: "MiMo V2.5 Pro",
          openRouterId: "xiaomi/mimo-v2.5-pro",
          inputModalities: ["text"],
          webSearch: true,
        }),
        expect.objectContaining({
          id: "kimi-k2-6",
          name: "Kimi K2.6",
          openRouterId: "moonshotai/kimi-k2.6",
          inputModalities: ["text", "image"],
        }),
        expect.objectContaining({
          id: "deepseek-v4-pro",
          name: "DeepSeek V4 Pro",
          openRouterId: "deepseek/deepseek-v4-pro",
          inputModalities: ["text"],
        }),
        expect.objectContaining({
          id: "gpt-5-4",
          name: "GPT-5.4",
          openRouterId: "openai/gpt-5.4",
          inputModalities: ["text", "image"],
          webSearch: true,
          imageGenerationOpenRouterId: "openai/gpt-5.4-image-2",
        }),
      ]),
    );
  });

  it("registers image generation pair slugs for supported models", () => {
    expect(getChatModelImageGenerationOpenRouterId("gpt-5-4")).toBe(
      "openai/gpt-5.4-image-2",
    );
    expect(
      getChatModelImageGenerationOpenRouterId("gemini-3-flash-preview"),
    ).toBe("google/gemini-3.1-flash-image-preview");
    expect(getChatModelImageGenerationOpenRouterId("gpt-5-2")).toBe(
      "openai/gpt-5.4-image-2",
    );
    expect(getChatModelImageGenerationOpenRouterId(null)).toBe(
      "openai/gpt-5.4-image-2",
    );
    expect(getChatModelImageGenerationOpenRouterId("grok-4-1-fast")).toBeNull();
    expect(getChatModelImageGenerationOpenRouterId("unknown-model")).toBeNull();

    expect(chatModelSupportsImageGeneration("gpt-5-4")).toBe(true);
    expect(chatModelSupportsImageGeneration("gemini-3-flash-preview")).toBe(
      true,
    );
    expect(chatModelSupportsImageGeneration("grok-4-1-fast")).toBe(false);
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

  it("reports image input support per catalog and legacy ids", () => {
    expect(chatModelSupportsImageInput("mimo-v2-5-pro")).toBe(false);
    expect(chatModelSupportsImageInput("deepseek-v4-pro")).toBe(false);
    expect(chatModelSupportsImageInput("kimi-k2-6")).toBe(true);
    expect(chatModelSupportsImageInput("gpt-5-4")).toBe(true);
    expect(chatModelSupportsImageInput(null)).toBe(true);
    expect(chatModelSupportsImageInput("kimi-k2-5")).toBe(true);
    expect(chatModelSupportsImageInput("deepseek-v3-2")).toBe(false);
    expect(chatModelSupportsImageInput("gpt-4o")).toBe(true);
    expect(chatModelSupportsImageInput("gpt-4")).toBe(false);
    expect(chatModelSupportsImageInput("mixtral-8x22b")).toBe(false);
  });

  it("reports web search support per catalog and legacy ids", () => {
    expect(chatModelSupportsWebSearch("mimo-v2-5-pro")).toBe(true);
    expect(chatModelSupportsWebSearch("deepseek-v4-pro")).toBe(true);
    expect(chatModelSupportsWebSearch("kimi-k2-6")).toBe(true);
    expect(chatModelSupportsWebSearch("gpt-5-4")).toBe(true);
    expect(chatModelSupportsWebSearch(null)).toBe(true);
    expect(chatModelSupportsWebSearch("kimi-k2-5")).toBe(true);
    expect(chatModelSupportsWebSearch("deepseek-v3-2")).toBe(true);
    expect(chatModelSupportsWebSearch("gpt-4o")).toBe(true);
    expect(chatModelSupportsWebSearch("gpt-4")).toBe(true);
    expect(chatModelSupportsWebSearch("mixtral-8x22b")).toBe(true);
    expect(chatModelSupportsWebSearch("unknown-model")).toBe(true);
  });
});
