import type { SsrfSafeFetchInit } from "@sokosumi/net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COWORKER_AGENT_ERROR_MARKER,
  COWORKER_AGENT_ERROR_SNIPPET,
  coworkerTextLooksLikeAgentError,
} from "./coworker-agent-error.js";
import { createSokosumiLanguageModel } from "./sokosumi-language-model.js";

const { ssrfSafeStreamFetchMock } = vi.hoisted(() => ({
  ssrfSafeStreamFetchMock:
    vi.fn<(url: string | URL, init: SsrfSafeFetchInit) => Promise<Response>>(),
}));
vi.mock("@sokosumi/net", () => ({
  ssrfSafeStreamFetch: ssrfSafeStreamFetchMock,
}));

describe("coworkerTextLooksLikeAgentError", () => {
  it("detects Elena agent error text and AGENT_ERROR markers", () => {
    expect(
      coworkerTextLooksLikeAgentError(
        `${COWORKER_AGENT_ERROR_SNIPPET}. Please try again.`,
      ),
    ).toBe(true);
    expect(coworkerTextLooksLikeAgentError(COWORKER_AGENT_ERROR_MARKER)).toBe(
      true,
    );
    expect(coworkerTextLooksLikeAgentError("Hello there")).toBe(false);
  });
});

describe("SokosumiLanguageModel coworker streaming", () => {
  beforeEach(() => {
    ssrfSafeStreamFetchMock.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unsafe coworker fetch is forbidden");
      }),
    );
  });

  afterEach(() => {
    for (const [, init] of ssrfSafeStreamFetchMock.mock.calls) {
      expect(init.maxResponseBytes).toBe(16 * 1024 * 1024);
      expect(init.headers?.["Accept-Encoding"]).toBe("identity");
    }
    vi.unstubAllGlobals();
  });

  it("streams coworker response body without buffering or duplicate POSTs", async () => {
    let call = 0;
    ssrfSafeStreamFetchMock.mockImplementation(async () => {
      call++;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
              ),
            );
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    });

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
          providerConversationId: "conv_new",
        },
      },
    });

    expect(call).toBe(1);

    const reader = stream.getReader();
    await reader.cancel();
  });
});
