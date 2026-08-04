import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COWORKER_AGENT_ERROR_MARKER,
  COWORKER_AGENT_ERROR_SNIPPET,
  coworkerSseBodyExtractOutputText,
  coworkerSseBodyLooksLikeAgentError,
  coworkerSseBodyLooksSuspiciouslyShort,
  coworkerTextLooksLikeAgentError,
} from "./coworker-agent-error.js";
import { createSokosumiLanguageModel } from "./sokosumi-language-model.js";

// Coworker mode fails closed without an SSRF guard; Core injects the real one.
const assertUrlAllowedMock = vi.fn();

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

describe("SokosumiLanguageModel coworker streaming", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("streams coworker response body without buffering or duplicate POSTs", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
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
          assertUrlAllowed: assertUrlAllowedMock,
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
