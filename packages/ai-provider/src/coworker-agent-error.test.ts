import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COWORKER_AGENT_ERROR_RETRY_DELAY_MS,
  COWORKER_AGENT_ERROR_SNIPPET,
  coworkerSseBodyExtractOutputText,
  coworkerSseBodyLooksLikeAgentError,
  coworkerSseBodyLooksSuspiciouslyShort,
} from "./coworker-agent-error.js";
import { createSokosumiLanguageModel } from "./sokosumi-language-model.js";

describe("coworkerSseBodyLooksLikeAgentError", () => {
  it("detects Elena agent error text in SSE bodies", () => {
    expect(
      coworkerSseBodyLooksLikeAgentError(
        `data: {"type":"response.output_text.delta","delta":"${COWORKER_AGENT_ERROR_SNIPPET}. Please try again."}`,
      ),
    ).toBe(true);
    expect(
      coworkerSseBodyLooksLikeAgentError(
        'data: {"type":"response.output_text.delta","delta":"Hello there"}',
      ),
    ).toBe(false);
  });
});

describe("coworkerSseBodyLooksSuspiciouslyShort", () => {
  it("detects suspiciously short output text in SSE bodies", () => {
    expect(
      coworkerSseBodyLooksSuspiciouslyShort(
        'data: {"type":"response.output_text.delta","delta":"Done"}',
      ),
    ).toBe(true);
    expect(
      coworkerSseBodyExtractOutputText(
        'data: {"type":"response.output_text.delta","delta":"Done"}',
      ),
    ).toBe("Done");
    expect(
      coworkerSseBodyLooksSuspiciouslyShort(
        'data: {"type":"response.output_text.delta","delta":"This is a complete coworker reply."}',
      ),
    ).toBe(false);
  });
});

describe("SokosumiLanguageModel coworker agent-error retry", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("retries conversation-mode streams that return Elena agent error text", async () => {
    vi.useFakeTimers();
    let call = 0;
    globalThis.fetch = vi.fn(async (url, init) => {
      call++;
      const delta =
        call === 1
          ? `${COWORKER_AGENT_ERROR_SNIPPET}. Please try again.`
          : "This is a complete coworker reply with enough text.";
      return new Response(
        `data: {"type":"response.output_text.delta","delta":"${delta}"}\n\n`,
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    }) as typeof fetch;

    const model = createSokosumiLanguageModel("anthropic/claude-3.5-sonnet", {
      openRouterApiKey: "sk-or-test",
    });

    const streamPromise = model.doStream({
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
          providerConversationId: "conv_new",
        },
      },
    });

    await vi.advanceTimersByTimeAsync(COWORKER_AGENT_ERROR_RETRY_DELAY_MS);

    const { stream } = await streamPromise;
    expect(call).toBe(2);

    const reader = stream.getReader();
    await reader.cancel();
  });

  it("retries conversation-mode streams that return suspiciously short text", async () => {
    vi.useFakeTimers();
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      const delta =
        call === 1
          ? "Done"
          : "This is a complete coworker reply with enough text.";
      return new Response(
        `data: {"type":"response.output_text.delta","delta":"${delta}"}\n\n`,
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    }) as typeof fetch;

    const model = createSokosumiLanguageModel("anthropic/claude-3.5-sonnet", {
      openRouterApiKey: "sk-or-test",
    });

    const streamPromise = model.doStream({
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
          providerConversationId: "conv_new",
        },
      },
    });

    await vi.advanceTimersByTimeAsync(COWORKER_AGENT_ERROR_RETRY_DELAY_MS);

    const { stream } = await streamPromise;
    expect(call).toBe(2);

    const reader = stream.getReader();
    await reader.cancel();
  });
});
