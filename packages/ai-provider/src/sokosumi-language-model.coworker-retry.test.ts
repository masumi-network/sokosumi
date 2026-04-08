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
});
