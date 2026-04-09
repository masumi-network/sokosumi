import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSokosumiLanguageModel } from "./sokosumi-language-model.js";

describe("SokosumiLanguageModel coworker invalid previous_response_id", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("retries without previous_response_id and invokes onInvalidPreviousResponseId", async () => {
    const onInvalidPreviousResponseId = vi.fn();
    let call = 0;

    globalThis.fetch = vi.fn(async (_url, init) => {
      call++;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (call === 1) {
        expect(body.previous_response_id).toBe("stale");
        return new Response("invalid_previous_response_id", { status: 400 });
      }
      expect(body.previous_response_id).toBeUndefined();
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
    }) as typeof fetch;

    const model = createSokosumiLanguageModel("anthropic/claude-3.5-sonnet", {
      openRouterApiKey: "sk-or-test",
    });

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      providerOptions: {
        sokosumi: {
          mode: "coworker",
          coworkerBaseUrl: "https://cow.example/api",
          coworkerSlug: "agent",
          sokosumiUserId: "user-1",
          previousResponseId: "stale",
          onInvalidPreviousResponseId,
        },
      },
    });

    expect(onInvalidPreviousResponseId).toHaveBeenCalledOnce();
    const reader = stream.getReader();
    await reader.cancel();
  });

  it("sends conversation_id and omits previous_response_id when providerConversationId is set", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async (_url, init) => {
      call++;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      expect(body.conversation_id).toBe("conv_abc");
      expect(body.previous_response_id).toBeUndefined();
      expect(body.input).toEqual([
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Only last" }],
        },
      ]);
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
    }) as typeof fetch;

    const model = createSokosumiLanguageModel("anthropic/claude-3.5-sonnet", {
      openRouterApiKey: "sk-or-test",
    });

    await model.doStream({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Earlier" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Old reply" }],
        },
        {
          role: "user",
          content: [{ type: "text", text: "Only last" }],
        },
      ],
      providerOptions: {
        sokosumi: {
          mode: "coworker",
          coworkerBaseUrl: "https://cow.example/api",
          coworkerSlug: "agent",
          sokosumiUserId: "user-1",
          previousResponseId: "resp_old",
          providerConversationId: "conv_abc",
        },
      },
    });

    expect(call).toBe(1);
  });

  it("retries without conversation_id when the API rejects the conversation", async () => {
    const onInvalidProviderConversationId = vi.fn();
    let call = 0;
    globalThis.fetch = vi.fn(async (_url, init) => {
      call++;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (call === 1) {
        expect(body.conversation_id).toBe("conv_bad");
        return new Response("invalid_conversation_id", { status: 400 });
      }
      expect(body.conversation_id).toBeUndefined();
      expect(body.previous_response_id).toBe("chain");
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
    }) as typeof fetch;

    const model = createSokosumiLanguageModel("anthropic/claude-3.5-sonnet", {
      openRouterApiKey: "sk-or-test",
    });

    const { stream } = await model.doStream({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
      providerOptions: {
        sokosumi: {
          mode: "coworker",
          coworkerBaseUrl: "https://cow.example/api",
          coworkerSlug: "agent",
          sokosumiUserId: "user-1",
          previousResponseId: "chain",
          providerConversationId: "conv_bad",
          onInvalidProviderConversationId,
        },
      },
    });

    expect(onInvalidProviderConversationId).toHaveBeenCalledOnce();
    const reader = stream.getReader();
    await reader.cancel();
  });
});
