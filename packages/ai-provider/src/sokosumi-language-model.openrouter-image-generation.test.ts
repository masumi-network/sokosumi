import { afterEach, describe, expect, it, vi } from "vitest";

import { createSokosumiLanguageModel } from "./sokosumi-language-model.js";

describe("SokosumiLanguageModel OpenRouter server tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("forwards the image generation server tool when a model is configured", async () => {
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn(async (_url, init) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null;
      return okStreamResponse();
    }) as typeof fetch;

    const model = createSokosumiLanguageModel("openai/gpt-5.4", {
      openRouterApiKey: "sk-or-test",
    });

    await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "A cat" }] }],
      providerOptions: {
        sokosumi: {
          mode: "openrouter",
          imageGenerationModel: "openai/gpt-5.4-image-2",
        },
      },
    });

    expect(requestBody).toMatchObject({
      model: "openai/gpt-5.4",
      tools: [
        {
          type: "openrouter:image_generation",
          parameters: {
            model: "openai/gpt-5.4-image-2",
            quality: "high",
          },
        },
      ],
    });
  });

  it("forwards the web search server tool when enabled", async () => {
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn(async (_url, init) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null;
      return okStreamResponse();
    }) as typeof fetch;

    const model = createSokosumiLanguageModel("openai/gpt-5.4", {
      openRouterApiKey: "sk-or-test",
    });

    await model.doStream({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "What happened today?" }],
        },
      ],
      providerOptions: {
        sokosumi: {
          mode: "openrouter",
          webSearchEnabled: true,
        },
      },
    });

    expect(requestBody).toMatchObject({
      model: "openai/gpt-5.4",
      tools: [
        {
          type: "openrouter:web_search",
        },
      ],
    });
  });

  it("forwards web search before image generation when both are enabled", async () => {
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn(async (_url, init) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null;
      return okStreamResponse();
    }) as typeof fetch;

    const model = createSokosumiLanguageModel("openai/gpt-5.4", {
      openRouterApiKey: "sk-or-test",
    });

    await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "A cat" }] }],
      providerOptions: {
        sokosumi: {
          mode: "openrouter",
          imageGenerationModel: "openai/gpt-5.4-image-2",
          webSearchEnabled: true,
        },
      },
    });

    expect(requestBody).toMatchObject({
      model: "openai/gpt-5.4",
      tools: [
        {
          type: "openrouter:web_search",
        },
        {
          type: "openrouter:image_generation",
          parameters: {
            model: "openai/gpt-5.4-image-2",
            quality: "high",
          },
        },
      ],
    });
  });

  it("omits server tools when none are enabled", async () => {
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn(async (_url, init) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null;
      return okStreamResponse();
    }) as typeof fetch;

    const model = createSokosumiLanguageModel("openai/gpt-5.4", {
      openRouterApiKey: "sk-or-test",
    });

    await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "A cat" }] }],
      providerOptions: {
        sokosumi: {
          mode: "openrouter",
        },
      },
    });

    expect(requestBody?.tools).toBeUndefined();
  });
});

function okStreamResponse(): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}
