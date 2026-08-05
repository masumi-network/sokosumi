import { InvalidPromptError } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COWORKER_AGENT_ERROR_SNIPPET } from "./coworker-agent-error.js";
import { createSokosumiLanguageModel } from "./sokosumi-language-model.js";

// Coworker mode fails closed without an SSRF guard; Core injects the real one.
const assertUrlAllowedMock = vi.fn();

async function collectStreamText(
  stream: ReadableStream<import("@ai-sdk/provider").LanguageModelV4StreamPart>,
): Promise<string> {
  const reader = stream.getReader();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value.type === "text-delta") {
      text += value.delta;
    }
  }
  return text;
}

function coworkerSseResponse(delta: string): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: {"type":"response.output_text.delta","delta":${JSON.stringify(delta)}}\n\n`,
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
}

describe("SokosumiLanguageModel coworker Conversations mode", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects coworker mode without providerConversationId or previousResponseId", async () => {
    const model = createSokosumiLanguageModel("anthropic/claude-3.5-sonnet", {
      openRouterApiKey: "sk-or-test",
    });

    await expect(
      model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        providerOptions: {
          sokosumi: {
            mode: "coworker",
            assertUrlAllowed: assertUrlAllowedMock,
            coworkerBaseUrl: "https://cow.example/api",
            coworkerSlug: "agent",
            sokosumiUserId: "user-1",
          },
        },
      }),
    ).rejects.toBeInstanceOf(InvalidPromptError);
  });

  it("sends conversation only and omits previous_response_id when both are set", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async (_url, init) => {
      call++;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(body.conversation).toBe("conv_abc");
      expect(body.previous_response_id).toBeUndefined();
      expect(body.input).toEqual([
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Only last" }],
        },
      ]);
      expect(headers["X-Coworker-Slug"]).toBe("agent");
      expect(headers["X-Sokosumi-User-Id"]).toBe("user-1");
      expect(headers["X-Sokosumi-Organization-Id"]).toBe("org-1");
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
          assertUrlAllowed: assertUrlAllowedMock,
          coworkerBaseUrl: "https://cow.example/api",
          coworkerSlug: "agent",
          sokosumiUserId: "user-1",
          sokosumiOrganizationId: "org-1",
          previousResponseId: "resp_old",
          providerConversationId: "conv_abc",
        },
      },
    });

    expect(call).toBe(1);
  });

  it("sends previous_response_id without conversation when only previousResponseId is set", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async (_url, init) => {
      call++;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(body.conversation).toBeUndefined();
      expect(body.previous_response_id).toBe("resp_only");
      expect(body.input).toEqual([
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Only last" }],
        },
      ]);
      expect(headers["X-Coworker-Slug"]).toBe("agent");
      expect(headers["X-Sokosumi-User-Id"]).toBe("user-1");
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
          assertUrlAllowed: assertUrlAllowedMock,
          coworkerBaseUrl: "https://cow.example/api",
          coworkerSlug: "agent",
          sokosumiUserId: "user-1",
          previousResponseId: "resp_only",
        },
      },
    });

    expect(call).toBe(1);
  });

  it("preserves error body on previous_response_id-only failures (no double response.text)", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("previous_response_not_found", { status: 400 });
    }) as typeof fetch;

    const model = createSokosumiLanguageModel("anthropic/claude-3.5-sonnet", {
      openRouterApiKey: "sk-or-test",
    });

    await expect(
      model.doStream({
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
            previousResponseId: "resp_stale",
          },
        },
      }),
    ).rejects.toThrowError(/previous_response_not_found/);
  });

  it("follows a 308 redirect and re-validates the new target", async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (url) => {
      seen.push(String(url));
      if (seen.length === 1) {
        return new Response(null, {
          status: 308,
          headers: { location: "https://cow.example/api/v2/responses" },
        });
      }
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"hi"}\n\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    }) as typeof fetch;

    const model = createSokosumiLanguageModel("anthropic/claude-3.5-sonnet", {
      openRouterApiKey: "sk-or-test",
    });

    await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      providerOptions: {
        sokosumi: {
          mode: "coworker",
          assertUrlAllowed: assertUrlAllowedMock,
          coworkerBaseUrl: "https://cow.example/api",
          coworkerSlug: "agent",
          sokosumiUserId: "user-1",
          previousResponseId: "resp_1",
        },
      },
    });

    expect(seen).toEqual([
      "https://cow.example/api/responses",
      "https://cow.example/api/v2/responses",
    ]);
    // Every hop is re-checked: a public host must not be able to bounce this
    // POST — identity headers and all — at an internal address.
    expect(assertUrlAllowedMock).toHaveBeenCalledTimes(2);
    expect(assertUrlAllowedMock).toHaveBeenLastCalledWith(
      "https://cow.example/api/v2/responses",
    );
  });

  it("does not follow a 302 that would downgrade the POST to GET", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("moved", {
        status: 302,
        headers: { location: "https://cow.example/elsewhere" },
      });
    }) as typeof fetch;

    const model = createSokosumiLanguageModel("anthropic/claude-3.5-sonnet", {
      openRouterApiKey: "sk-or-test",
    });

    // Following it would silently drop the request body, so the 302 surfaces
    // as an ordinary upstream failure instead.
    await expect(
      model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        providerOptions: {
          sokosumi: {
            mode: "coworker",
            assertUrlAllowed: assertUrlAllowedMock,
            coworkerBaseUrl: "https://cow.example/api",
            coworkerSlug: "agent",
            sokosumiUserId: "user-1",
            previousResponseId: "resp_1",
          },
        },
      }),
    ).rejects.toThrowError();
    expect(assertUrlAllowedMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a cross-origin redirect instead of leaking identity headers", async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (url) => {
      seen.push(String(url));
      return new Response(null, {
        status: 307,
        headers: { location: "https://attacker.example/responses" },
      });
    }) as typeof fetch;

    const model = createSokosumiLanguageModel("anthropic/claude-3.5-sonnet", {
      openRouterApiKey: "sk-or-test",
    });

    // The SSRF guard only rejects private addresses; a third-party PUBLIC host
    // would still receive the Sokosumi user/org headers and the prompt body.
    await expect(
      model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        providerOptions: {
          sokosumi: {
            mode: "coworker",
            assertUrlAllowed: assertUrlAllowedMock,
            coworkerBaseUrl: "https://cow.example/api",
            coworkerSlug: "agent",
            sokosumiUserId: "user-1",
            previousResponseId: "resp_1",
          },
        },
      }),
    ).rejects.toThrowError(/different origin/);

    expect(seen).toEqual(["https://cow.example/api/responses"]);
  });

  it("stops a redirect loop instead of following it forever", async () => {
    let hops = 0;
    globalThis.fetch = vi.fn(async () => {
      hops += 1;
      return new Response(null, {
        status: 307,
        headers: { location: "https://cow.example/api/loop" },
      });
    }) as typeof fetch;

    const model = createSokosumiLanguageModel("anthropic/claude-3.5-sonnet", {
      openRouterApiKey: "sk-or-test",
    });

    await expect(
      model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        providerOptions: {
          sokosumi: {
            mode: "coworker",
            assertUrlAllowed: assertUrlAllowedMock,
            coworkerBaseUrl: "https://cow.example/api",
            coworkerSlug: "agent",
            sokosumiUserId: "user-1",
            previousResponseId: "resp_1",
          },
        },
      }),
    ).rejects.toThrowError(/redirects/);
    expect(hops).toBeLessThanOrEqual(4);
  });

  it("retries without conversation when the API rejects the conversation", async () => {
    const onInvalidProviderConversationId = vi.fn();
    let call = 0;
    globalThis.fetch = vi.fn(async (_url, init) => {
      call++;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers["X-Coworker-Slug"]).toBe("agent");
      expect(headers["X-Sokosumi-User-Id"]).toBe("user-1");
      expect(headers["X-Sokosumi-Organization-Id"]).toBeUndefined();
      if (call === 1) {
        expect(body.conversation).toBe("conv_bad");
        expect(body.previous_response_id).toBeUndefined();
        expect(body.input).toEqual([
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Hello" }],
          },
        ]);
        return new Response("invalid_conversation_id", { status: 400 });
      }
      expect(body.conversation).toBeUndefined();
      expect(body.previous_response_id).toBeUndefined();
      expect(body.input).toEqual([
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello" }],
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
          previousResponseId: "resp_old",
          providerConversationId: "conv_bad",
          onInvalidProviderConversationId,
        },
      },
    });

    expect(onInvalidProviderConversationId).toHaveBeenCalledOnce();
    const reader = stream.getReader();
    await reader.cancel();
  });

  it("retries conversation-mode streams that return Elena agent error text", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      const delta =
        call === 1
          ? `${COWORKER_AGENT_ERROR_SNIPPET}. Please try again.`
          : "This is a complete coworker reply with enough text.";
      return coworkerSseResponse(delta);
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

    const text = await collectStreamText(stream);
    expect(call).toBe(2);
    expect(text).toBe("This is a complete coworker reply with enough text.");
  });

  it("retries conversation-mode streams that return suspiciously short text", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      const delta =
        call === 1
          ? "Done"
          : "This is a complete coworker reply with enough text.";
      return coworkerSseResponse(delta);
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

    const text = await collectStreamText(stream);
    expect(call).toBe(2);
    expect(text).toBe("This is a complete coworker reply with enough text.");
  });

  it("does not retry previous_response_id-only coworker streams", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      return coworkerSseResponse(
        `${COWORKER_AGENT_ERROR_SNIPPET}. Please try again.`,
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
          previousResponseId: "resp_only",
        },
      },
    });

    expect(call).toBe(1);
    const text = await collectStreamText(stream);
    expect(text).toContain(COWORKER_AGENT_ERROR_SNIPPET);
  });

  it("streams good conversation output without duplicate POSTs", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      return coworkerSseResponse(
        "This is a complete coworker reply with enough text.",
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
    const text = await collectStreamText(stream);
    expect(text).toBe("This is a complete coworker reply with enough text.");
  });
});
